'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell
} = require('electron');
const {
  buildEngine,
  generateEngine,
  getEnvironment,
  inspectRepositoryLayout,
  normalizeConfig,
  validateConfig
} = require('./generator');

const rendererEntry = path.join(__dirname, 'renderer', 'index.html');
const appIcon = path.join(__dirname, '..', 'assets', 'app-icon.png');
const maxConfigBytes = 1024 * 1024;
const requestedKit = 'Desktop_Qt_5_14_2_MSVC2017_64bit-Release';

const channels = Object.freeze({
  getEnvironment: 'environment:get',
  openConfig: 'config:open',
  saveConfig: 'config:save',
  selectPath: 'path:select',
  generate: 'engine:generate',
  build: 'engine:build',
  openGenerated: 'generated:open',
  buildLog: 'build:log'
});

const selectablePaths = Object.freeze({
  repoRoot: {
    title: '选择 VOFA+ 仓库根目录',
    properties: ['openDirectory', 'dontAddToRecent']
  },
  qmakePath: {
    title: '选择 qmake.exe',
    filters: [{ name: 'qmake', extensions: ['exe'] }]
  },
  jomPath: {
    title: '选择 jom.exe',
    filters: [{ name: 'jom', extensions: ['exe'] }]
  },
  vcVarsPath: {
    title: '选择 Visual C++ 环境脚本',
    filters: [{ name: 'Batch scripts', extensions: ['bat', 'cmd'] }]
  }
});

let mainWindow = null;
let buildInProgress = false;
let configLocations = null;

function sameLocalPath(left, right) {
  const normalize = (value) => path.resolve(value).toLowerCase();
  return normalize(left) === normalize(right);
}

function assertTrustedSender(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Rejected IPC request from an untrusted renderer.');
  }

  let senderPath;
  try {
    const senderUrl = new URL(event.senderFrame.url);
    if (senderUrl.protocol !== 'file:') {
      throw new Error('Unexpected renderer protocol.');
    }
    senderPath = fileURLToPath(senderUrl);
  } catch (_error) {
    throw new Error('Rejected IPC request with an invalid renderer URL.');
  }

  if (!sameLocalPath(senderPath, rendererEntry)) {
    throw new Error('Rejected IPC request from an unexpected renderer document.');
  }
}

function assertArgumentCount(args, expected) {
  if (args.length !== expected) {
    throw new TypeError(`Expected ${expected} IPC argument(s), received ${args.length}.`);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
}

function assertSafeConfigPayload(config) {
  assertPlainObject(config, 'config');

  let serialized;
  try {
    serialized = JSON.stringify(config);
  } catch (_error) {
    throw new TypeError('config must be JSON serializable.');
  }

  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maxConfigBytes) {
    throw new RangeError(`config must be no larger than ${maxConfigBytes} bytes.`);
  }
}

function formatValidationErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'Unknown configuration error.';
  }
  return errors.map((error) => String(error)).join('; ');
}

async function prepareConfig(config) {
  assertSafeConfigPayload(config);
  const validation = await validateConfig(config);

  if (!isPlainObject(validation) || validation.valid !== true) {
    const errors = isPlainObject(validation) ? validation.errors : null;
    throw new TypeError(`Invalid engine configuration: ${formatValidationErrors(errors)}`);
  }

  const normalized = validation.config ?? (await normalizeConfig(config));
  assertSafeConfigPayload(normalized);
  return normalized;
}

function prepareEnvironment(environment) {
  assertPlainObject(environment, 'environment');

  const allowedKeys = new Set([
    'repoRoot',
    'dataEnginesDir',
    'qmakePath',
    'jomPath',
    'vcVarsPath',
    'kitName'
  ]);
  for (const key of Object.keys(environment)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`environment contains an unsupported field: ${key}.`);
    }
  }

  const repoRoot = environment.repoRoot;
  if (typeof repoRoot !== 'string'
      || repoRoot.trim() === ''
      || repoRoot.length > 32767
      || repoRoot.includes('\0')) {
    throw new TypeError('environment.repoRoot must be a selected repository path.');
  }
  const resolvedRepoRoot = path.resolve(repoRoot.trim());
  const layout = inspectRepositoryLayout(resolvedRepoRoot);
  if (!layout.valid) {
    const error = new Error(layout.message);
    error.code = 'INVALID_REPOSITORY';
    throw error;
  }

  if (environment.dataEnginesDir !== undefined
      && environment.dataEnginesDir !== null
      && environment.dataEnginesDir !== '') {
    if (typeof environment.dataEnginesDir !== 'string'
        || environment.dataEnginesDir.length > 32767
        || environment.dataEnginesDir.includes('\0')
        || !sameLocalPath(environment.dataEnginesDir, layout.dataEnginesDirectory)) {
      throw new TypeError('environment.dataEnginesDir must match <repoRoot>/dataengines.');
    }
  }

  if (
    environment.kitName !== undefined &&
    environment.kitName !== null &&
    environment.kitName !== '' &&
    environment.kitName !== requestedKit
  ) {
    throw new TypeError(`environment.kitName must be ${requestedKit}.`);
  }

  const result = {
    repoRoot: resolvedRepoRoot,
    dataEnginesDir: layout.dataEnginesDirectory
  };
  for (const key of ['qmakePath', 'jomPath', 'vcVarsPath']) {
    const value = environment[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value !== 'string' || value.length > 32767 || value.includes('\0')) {
      throw new TypeError(`environment.${key} must be a valid path string.`);
    }
    result[key] = path.resolve(value);
  }

  return result;
}

function optionalRepoRoot(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 32767 || value.includes('\0')) {
    throw new TypeError('repoRoot must be a valid path string.');
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : path.resolve(trimmed);
}

function environmentScanRequest(value) {
  if (!isPlainObject(value)) return optionalRepoRoot(value);
  const allowedKeys = new Set([
    'repoRoot',
    'dataEnginesDir',
    'qmakePath',
    'jomPath',
    'vcVarsPath',
    'kitName'
  ]);
  Object.keys(value).forEach((key) => {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`environment contains an unsupported field: ${key}.`);
    }
  });
  if (value.kitName && value.kitName !== requestedKit) {
    throw new TypeError(`environment.kitName must be ${requestedKit}.`);
  }
  const request = {};
  ['repoRoot', 'qmakePath', 'jomPath', 'vcVarsPath'].forEach((key) => {
    const input = value[key];
    if (input === undefined || input === null || input === '') return;
    if (typeof input !== 'string' || input.length > 32767 || input.includes('\0')) {
      throw new TypeError(`environment.${key} must be a valid path string.`);
    }
    const trimmed = input.trim();
    if (trimmed) request[key] = path.resolve(trimmed);
  });
  if (value.dataEnginesDir !== undefined
      && value.dataEnginesDir !== null
      && value.dataEnginesDir !== '') {
    if (typeof value.dataEnginesDir !== 'string'
        || value.dataEnginesDir.length > 32767
        || value.dataEnginesDir.includes('\0')) {
      throw new TypeError('environment.dataEnginesDir must be a valid path string.');
    }
    if (request.repoRoot
        && !sameLocalPath(value.dataEnginesDir, path.join(request.repoRoot, 'dataengines'))) {
      throw new TypeError('environment.dataEnginesDir must match <repoRoot>/dataengines.');
    }
  }
  return request;
}

function persistableConfig(config) {
  return {
    version: config.version,
    engineName: config.engineName,
    descriptionAutoSync: config.descriptionAutoSync === true,
    descriptions: config.descriptions,
    wordCount: config.wordCount,
    fields: config.fields
  };
}

function unwrapConfigDocument(document) {
  assertSafeConfigPayload(document);
  if (Object.hasOwn(document, 'generator')) {
    if (document.generator !== 'vofa-justfloat-engine-builder'
        || ![1, 2].includes(document.version)
        || !isPlainObject(document.config)) {
      throw new TypeError('生成器配置文件无效：缺少有效的 config 配置或版本不受支持。');
    }
    return document.config;
  }
  if (!Object.hasOwn(document, 'fields')
      && ['SimplifiedChinese', 'TraditionalChinese', 'English'].some((key) => Object.hasOwn(document, key))) {
    throw new TypeError('这是 VOFA+ 插件描述文件，不包含通道配置。请选择保存的配置 JSON，或源码目录中的 .vofa-engine-builder.json。');
  }
  return document;
}

function configLocationsFile() {
  return path.join(app.getPath('userData'), 'config-dialog-locations.json');
}

function rememberedConfigLocations() {
  if (configLocations === null) {
    configLocations = new Map();
    try {
      const filePath = configLocationsFile();
      if (fs.statSync(filePath).size <= maxConfigBytes) {
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (isPlainObject(saved)) configLocations = new Map(Object.entries(saved));
      }
    } catch (_error) {
      // Missing or damaged preferences must not prevent opening a configuration.
    }
  }
  return configLocations;
}

function configLocationKey(repoRoot) {
  return repoRoot ? path.resolve(repoRoot).toLowerCase() : '';
}

function existingDirectory(directory) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0')) return false;
  try {
    return fs.statSync(directory).isDirectory();
  } catch (_error) {
    return false;
  }
}

function configDialogDirectory(repoRoot) {
  const remembered = rememberedConfigLocations().get(configLocationKey(repoRoot));
  const dataEnginesDirectory = repoRoot ? path.join(repoRoot, 'dataengines') : null;
  return [remembered, dataEnginesDirectory, app.getPath('documents')].find(existingDirectory)
    || app.getPath('home');
}

async function rememberConfigDirectory(repoRoot, filePath) {
  const locations = rememberedConfigLocations();
  locations.set(configLocationKey(repoRoot), path.dirname(filePath));
  try {
    await fs.promises.writeFile(configLocationsFile(), `${JSON.stringify(Object.fromEntries(locations), null, 2)}\n`, 'utf8');
  } catch (error) {
    // A successful load/save stays successful even if preferences are read-only.
    console.warn(`Cannot remember configuration directory: ${error.message}`);
  }
}

async function confirmLegacyArtifactReplacement(error) {
  if (!error || error.code !== 'OUTPUT_EXISTS' || !error.details?.requiresConfirmation) {
    throw error;
  }
  const artifacts = Array.isArray(error.details.artifacts)
    ? error.details.artifacts.join('\n')
    : error.message;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '发现旧版生成产物',
    message: '目标 DLL 或 JSON 已存在，但尚未建立新版源码标记。',
    detail: `确认这些文件属于旧版 JustFloat 生成器后才可替换：\n${artifacts}`,
    buttons: ['取消', '确认迁移并替换'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  return result.response === 1;
}

function registerHandler(channel, expectedArgumentCount, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    assertArgumentCount(args, expectedArgumentCount);
    return handler(event, ...args);
  });
}

function registerIpcHandlers() {
  registerHandler(channels.getEnvironment, 1, async (_event, repoRoot) => {
    return getEnvironment(environmentScanRequest(repoRoot));
  });

  registerHandler(channels.openConfig, 1, async (_event, selectedRepoRoot) => {
    const repoRoot = optionalRepoRoot(selectedRepoRoot);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开数据引擎配置',
      defaultPath: configDialogDirectory(repoRoot),
      properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
      filters: [
        { name: 'JSON configuration', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length !== 1) {
      return null;
    }

    const filePath = result.filePaths[0];
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile() || stats.size > maxConfigBytes) {
      throw new RangeError(`Configuration files must be no larger than ${maxConfigBytes} bytes.`);
    }

    let config;
    try {
      config = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read configuration: ${error.message}`);
    }

    const normalized = await prepareConfig(unwrapConfigDocument(config));
    await rememberConfigDirectory(repoRoot, filePath);
    return { filePath, config: normalized };
  });

  registerHandler(channels.saveConfig, 2, async (_event, config, selectedRepoRoot) => {
    const repoRoot = optionalRepoRoot(selectedRepoRoot);
    const normalized = await prepareConfig(config);
    const safeTargetName = String(normalized.targetName || 'customengine')
      .replace(/[^A-Za-z0-9_-]/g, '_');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存数据引擎配置',
      defaultPath: path.join(configDialogDirectory(repoRoot), `${safeTargetName}.json`),
      filters: [{ name: 'JSON configuration', extensions: ['json'] }],
      properties: ['dontAddToRecent']
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const filePath = path.extname(result.filePath).toLowerCase() === '.json'
      ? result.filePath
      : `${result.filePath}.json`;
    await fs.promises.writeFile(filePath, `${JSON.stringify(persistableConfig(normalized), null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'w'
    });
    await rememberConfigDirectory(repoRoot, filePath);
    return { filePath };
  });

  registerHandler(channels.selectPath, 1, async (_event, kind) => {
    if (typeof kind !== 'string' || !Object.hasOwn(selectablePaths, kind)) {
      throw new TypeError(
        'kind must identify repoRoot, qmakePath, jomPath, or vcVarsPath.'
      );
    }

    const definition = selectablePaths[kind];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: definition.title,
      properties: definition.properties || ['openFile', 'dontAddToRecent'],
      filters: definition.filters
    });
    return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
  });

  registerHandler(channels.generate, 2, async (_event, config, environment) => {
    const normalized = await prepareConfig(config);
    const selected = prepareEnvironment(environment);
    try {
      return generateEngine(normalized, { repoRoot: selected.repoRoot });
    } catch (error) {
      if (!(await confirmLegacyArtifactReplacement(error))) throw error;
      return generateEngine(normalized, {
        repoRoot: selected.repoRoot,
        allowExistingArtifacts: true
      });
    }
  });

  registerHandler(channels.build, 2, async (event, config, environment) => {
    if (buildInProgress) {
      throw new Error('A data engine build is already running.');
    }

    buildInProgress = true;
    try {
      const normalized = await prepareConfig(config);
      const toolPaths = prepareEnvironment(environment);
      const renderer = event.sender;
      const onOutput = (output) => {
        if (!renderer.isDestroyed()) {
          renderer.send(channels.buildLog, String(output));
        }
      };

      const buildOptions = { ...toolPaths, onOutput };
      try {
        return await buildEngine(normalized, buildOptions);
      } catch (error) {
        if (!(await confirmLegacyArtifactReplacement(error))) throw error;
        return await buildEngine(normalized, {
          ...buildOptions,
          allowExistingArtifacts: true
        });
      }
    } finally {
      buildInProgress = false;
    }
  });

  registerHandler(channels.openGenerated, 1, async (_event, environmentOrRepoRoot) => {
    const selected = typeof environmentOrRepoRoot === 'string'
      ? prepareEnvironment({ repoRoot: environmentOrRepoRoot })
      : prepareEnvironment(environmentOrRepoRoot);
    const generatedDirectory = path.join(selected.dataEnginesDir, 'generated');
    const errorMessage = await shell.openPath(generatedDirectory);
    if (errorMessage) {
      throw new Error(`Cannot open generated directory: ${errorMessage}`);
    }
    return generatedDirectory;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f5',
    title: 'JustFloat 自定义数据引擎生成器',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let isRendererEntry = false;
    try {
      const parsed = new URL(targetUrl);
      isRendererEntry = parsed.protocol === 'file:' &&
        sameLocalPath(fileURLToPath(parsed), rendererEntry);
    } catch (_error) {
      isRendererEntry = false;
    }
    if (!isRendererEntry) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(rendererEntry);
}

registerIpcHandlers();

app.whenReady().then(() => {
  app.setAppUserModelId('plus.vofa.justfloat-engine-config');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
