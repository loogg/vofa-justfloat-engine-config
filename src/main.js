'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { createBackendService } = require('./backend/service');
const { channels, argumentCounts } = require('./backend/contract');
const rendererEntry = path.join(__dirname, 'renderer', 'index.html');
const appIcon = path.join(__dirname, '..', 'assets', 'app-icon.png');
let mainWindow = null;

// Keep development review preferences and Chromium caches in the workspace.
if (!app.isPackaged && process.env.VOFA_REVIEW_USER_DATA) {
  const developmentDirectory = path.resolve(process.env.VOFA_REVIEW_USER_DATA);
  const scratchDirectory = path.resolve(__dirname, '..', 'scratch');
  if (!developmentDirectory.startsWith(`${scratchDirectory}${path.sep}`)) {
    throw new Error('Development userData must be inside the project scratch directory');
  }
  app.setPath('userData', developmentDirectory);
}

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


const backend = createBackendService({
  mode: 'native',
  getPath: (kind) => app.getPath(kind),
  dialog: {
    showOpenDialog: (options) => dialog.showOpenDialog(mainWindow, options),
    showSaveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
    showMessageBox: (options) => dialog.showMessageBox(mainWindow, options)
  },
  openPath: (target) => shell.openPath(target),
  openExternal: (url) => shell.openExternal(url)
});

for (const [method, count] of Object.entries(argumentCounts)) {
  ipcMain.handle(channels[method], async (event, ...args) => {
    assertTrustedSender(event);
    if (args.length !== count) throw new TypeError('Invalid IPC argument count');
    return backend.invoke(method, args, (output) => {
      if (!event.sender.isDestroyed()) event.sender.send(channels.buildLog, output);
    });
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
