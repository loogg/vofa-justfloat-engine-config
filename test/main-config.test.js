'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { generateEngine, normalizeConfig } = require('../src/generator');

const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'scratch/tests'), { recursive: true });
const fixtureRepo = path.join(__dirname, 'fixtures', 'vofa-repository');
const config = {
  version: 2,
  engineName: 'Test Engine',
  wordCount: 1,
  fields: [{ wordIndex: 0, type: 'int16', bitOffset: 8, name: 'temperature' }],
  descriptionAutoSync: false,
  descriptions: { English: { format: 'A hand-written description.' } }
};

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../scratch/tests'), 'vofa-config-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(path.resolve(__dirname, '../scratch/tests')));
    assert.match(path.basename(directory), /^vofa-config-test-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const entry of ['userData', 'documents', 'other', 'repo/dataengines', 'repo2/dataengines']) {
    fs.mkdirSync(path.join(directory, entry), { recursive: true });
  }
  return directory;
}

function writeJson(directory, name, value) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

// Exercise the actual IPC handlers and filesystem; only native Electron UI is stubbed.
function launch(directory) {
  const handlers = new Map();
  const dialogs = [];
  const windowEvents = new Map();
  let nextOpen = { canceled: true, filePaths: [] };
  let nextSave = { canceled: true };
  let nextClose = 0;
  let window;
  const electron = {
    app: {
      getPath: (kind) => kind === 'home' ? directory : path.join(directory, kind),
      whenReady: () => ({ then: (ready) => ready() }),
      setAppUserModelId() {},
      on() {}
    },
    BrowserWindow: class {
      constructor() {
        window = this;
        this.webContents = {
          mainFrame: { url: pathToFileURL(path.join(root, 'src/renderer/index.html')).href },
          setWindowOpenHandler() {},
          on: (name, handler) => windowEvents.set(name, handler)
        };
      }
      isDestroyed() { return false; }
      once() {}
      on() {}
      loadFile() {}
    },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {
      showOpenDialog: async (_window, options) => { dialogs.push(options); return nextOpen; },
      showSaveDialog: async (_window, options) => { dialogs.push(options); return nextSave; },
      showMessageBoxSync: (_window, options) => { dialogs.push(options); return nextClose; }
    }
  };
  const mainFile = path.join(root, 'src/main.js');
  const localRequire = createRequire(mainFile);
  new Function('require', '__dirname', fs.readFileSync(mainFile, 'utf8'))(
    (name) => name === 'electron' ? electron : localRequire(name), path.dirname(mainFile)
  );
  return {
    dialogs,
    chooseOpen: (filePath) => { nextOpen = { canceled: false, filePaths: [filePath] }; },
    chooseSave: (filePath) => { nextSave = { canceled: false, filePath }; },
    chooseClose: (response) => { nextClose = response; },
    preventUnload: () => {
      let allowed = false;
      windowEvents.get('will-prevent-unload')({ preventDefault: () => { allowed = true; } });
      return allowed;
    },
    invokeUntrusted: (channel, ...args) => handlers.get(channel)({
      sender: window.webContents, senderFrame: { url: 'https://untrusted.example/' }
    }, ...args),
    invoke: (channel, ...args) => handlers.get(channel)({
      sender: window.webContents, senderFrame: window.webContents.mainFrame
    }, ...args)
  };
}

test('native unload confirmation stays open unless the user explicitly discards changes', (t) => {
  const application = launch(workspace(t));
  assert.equal(application.preventUnload(), false);
  const warning = application.dialogs.at(-1);
  assert.equal(warning.defaultId, 0);
  assert.equal(warning.cancelId, 0);
  assert.deepEqual(warning.buttons, ['继续编辑', '放弃更改并继续']);
  application.chooseClose(1);
  assert.equal(application.preventUnload(), true);
  application.chooseClose(-1);
  assert.equal(application.preventUnload(), false);
});

test('open imports both saved JSON and a real generated marker without changing either file', async (t) => {
  const directory = workspace(t);
  const repo = path.join(directory, 'repo');
  fs.cpSync(fixtureRepo, repo, { recursive: true });
  const savedFile = writeJson(directory, 'saved.json', config);
  const generated = generateEngine(config, { repoRoot: repo });
  const application = launch(directory);
  for (const filePath of [savedFile, generated.configFile]) {
    const before = fs.readFileSync(filePath, 'utf8');
    application.chooseOpen(filePath);
    const result = await application.invoke('config:open', repo);
    assert.equal(result.filePath, filePath);
    assert.deepEqual(result.config, normalizeConfig(config));
    assert.equal(fs.readFileSync(filePath, 'utf8'), before);
  }
  assert.equal(application.dialogs[0].defaultPath, path.join(repo, 'dataengines'));
  assert.ok(application.dialogs[0].properties.includes('showHiddenFiles'));
});

test('open preserves version 1 migration for saved and wrapped configurations', async (t) => {
  const directory = workspace(t);
  const application = launch(directory);
  const legacy = { ...config, version: 1, displayName: 'Test Engine', targetName: 'testengine', className: 'TestEngine' };
  delete legacy.engineName;
  for (const document of [legacy, { generator: 'vofa-justfloat-engine-builder', version: 1, config: legacy }]) {
    application.chooseOpen(writeJson(directory, 'legacy.json', document));
    assert.deepEqual((await application.invoke('config:open', null)).config, normalizeConfig(legacy));
  }
});

test('invalid markers and plugin descriptions report useful errors and nested config is still validated', async (t) => {
  const directory = workspace(t);
  const application = launch(directory);
  const marker = { generator: 'vofa-justfloat-engine-builder', version: 2, config };
  const cases = [
    [{ ...marker, config: null }, /生成器配置文件无效/],
    [{ ...marker, generator: 'another-tool' }, /生成器配置文件无效/],
    [{ ...marker, version: 99 }, /版本不受支持/],
    [{ ...marker, config: { ...config, wordCount: 0 } }, /wordCount must be an integer/],
    [{ ...marker, config: { ...config, fields: [] } }, /fields must contain at least one/],
    [JSON.parse(fs.readFileSync(path.join(fixtureRepo, 'dataengines/generated/justfloat.json'), 'utf8')), /插件描述文件.*不包含通道配置/]
  ];
  for (const [document, error] of cases) {
    application.chooseOpen(writeJson(path.join(directory, 'other'), 'bad.json', document));
    await assert.rejects(application.invoke('config:open', path.join(directory, 'repo')), error);
  }
  assert.ok(application.dialogs.every((options) => options.defaultPath === path.join(directory, 'repo/dataengines')));
  assert.equal(fs.existsSync(path.join(directory, 'userData/config-dialog-locations.json')), false);
});

test('open rejects malformed JSON and files larger than 1 MiB', async (t) => {
  const directory = workspace(t);
  const application = launch(directory);
  const filePath = path.join(directory, 'bad.json');
  application.chooseOpen(filePath);
  fs.writeFileSync(filePath, '{');
  await assert.rejects(application.invoke('config:open', null), /Cannot read configuration/);
  fs.writeFileSync(filePath, ' '.repeat(1024 * 1024 + 1));
  await assert.rejects(application.invoke('config:open', null), /no larger than 1048576 bytes/);
});

test('successful load and save share a directory per repository and persist across restarts', async (t) => {
  const directory = workspace(t);
  const repo = path.join(directory, 'repo');
  const repo2 = path.join(directory, 'repo2');
  const other = path.join(directory, 'other');
  let application = launch(directory);
  application.chooseOpen(writeJson(other, 'load.json', config));
  await application.invoke('config:open', repo);

  application = launch(directory);
  assert.equal(await application.invoke('config:open', repo), null);
  assert.equal(application.dialogs.at(-1).defaultPath, other);
  await application.invoke('config:open', repo2);
  assert.equal(application.dialogs.at(-1).defaultPath, path.join(repo2, 'dataengines'));
  await application.invoke('config:save', config, repo);
  assert.equal(application.dialogs.at(-1).defaultPath, path.join(other, 'testengine.json'));

  const savePath = path.join(repo, 'dataengines/saved');
  application.chooseSave(savePath);
  const saved = await application.invoke('config:save', config, repo);
  assert.equal(saved.filePath, `${savePath}.json`);
  assert.equal(JSON.parse(fs.readFileSync(saved.filePath, 'utf8')).engineName, config.engineName);
  application = launch(directory);
  await application.invoke('config:open', repo);
  assert.equal(application.dialogs.at(-1).defaultPath, path.join(repo, 'dataengines'));
  application.chooseOpen(saved.filePath);
  assert.deepEqual((await application.invoke('config:open', repo)).config, normalizeConfig(config));
});

test('cancelled or failed saves do not change the remembered directory', async (t) => {
  const directory = workspace(t);
  const repo = path.join(directory, 'repo');
  let application = launch(directory);
  await application.invoke('config:open', repo);
  await application.invoke('config:save', config, repo);
  assert.equal(fs.existsSync(path.join(directory, 'userData/config-dialog-locations.json')), false);
  application.chooseSave(path.join(directory, 'missing/file.json'));
  await assert.rejects(application.invoke('config:save', config, repo), /ENOENT/);
  application = launch(directory);
  await application.invoke('config:open', repo);
  assert.equal(application.dialogs.at(-1).defaultPath, path.join(repo, 'dataengines'));
});

test('missing or corrupt preferences and missing directories fall back to dataengines or Documents', async (t) => {
  const directory = workspace(t);
  const repo = path.join(directory, 'repo');
  const settingsFile = path.join(directory, 'userData/config-dialog-locations.json');
  for (const remembered of [path.join(directory, 'deleted'), settingsFile, 42]) {
    writeJson(path.dirname(settingsFile), path.basename(settingsFile), { [repo.toLowerCase()]: remembered });
    const application = launch(directory);
    await application.invoke('config:open', repo);
    assert.equal(application.dialogs.at(-1).defaultPath, path.join(repo, 'dataengines'));
  }
  fs.writeFileSync(settingsFile, '{corrupt');
  const application = launch(directory);
  await application.invoke('config:open', repo);
  assert.equal(application.dialogs.at(-1).defaultPath, path.join(repo, 'dataengines'));
  for (const selected of [null, '', path.join(directory, 'missing-repo')]) {
    await application.invoke('config:open', selected);
    assert.equal(application.dialogs.at(-1).defaultPath, path.join(directory, 'documents'));
  }
  await assert.rejects(application.invoke('config:open', { repoRoot: repo }), /valid path string/);
  await assert.rejects(application.invoke('config:save', config, 'invalid\0path'), /valid path string/);
});

test('preload passes repository context through the restricted open/save API', async () => {
  const calls = [];
  let api;
  new Function('require', fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8'))(() => ({
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); } }
  }));
  await api.openConfig('selected-repo');
  await api.saveConfig(config, 'selected-repo');
  await api.openConfig();
  await api.getAppInfo();
  await api.selectPath('vofaPath');
  assert.deepEqual(calls, [
    ['config:open', 'selected-repo'],
    ['config:save', config, 'selected-repo'],
    ['config:open', undefined],
    ['app:info'],
    ['path:select', 'vofaPath']
  ]);
});

test('native IPC rejects other frames and reports package version through the same contract', async (t) => {
  const application = launch(workspace(t));
  await assert.rejects(application.invokeUntrusted('app:info'), /untrusted renderer/);
  await assert.rejects(application.invoke('app:info', 'unexpected'), /Invalid IPC argument count/);
  const info = await application.invoke('app:info');
  assert.equal(info.version, require('../package.json').version);
  assert.equal(info.mode, 'native');
  application.chooseOpen(root);
  assert.equal(await application.invoke('path:select', 'vofaPath'), root);
  assert.match(application.dialogs.at(-1).title, /VOFA\+ 安装目录/);
  assert.ok(application.dialogs.at(-1).properties.includes('openDirectory'));
});
