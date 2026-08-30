'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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

const engineApi = Object.freeze({
  getEnvironment: (repoRootOrEnvironment) =>
    ipcRenderer.invoke(channels.getEnvironment, repoRootOrEnvironment),
  openConfig: () => ipcRenderer.invoke(channels.openConfig),
  saveConfig: (config) => ipcRenderer.invoke(channels.saveConfig, config),
  selectPath: (kind) => ipcRenderer.invoke(channels.selectPath, kind),
  generate: (config, environment) =>
    ipcRenderer.invoke(channels.generate, config, environment),
  build: (config, environment) =>
    ipcRenderer.invoke(channels.build, config, environment),
  openGenerated: (environmentOrRepoRoot) =>
    ipcRenderer.invoke(channels.openGenerated, environmentOrRepoRoot),
  onBuildLog: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onBuildLog(callback) requires a function.');
    }

    const listener = (_event, message) => callback(message);
    ipcRenderer.on(channels.buildLog, listener);

    return () => ipcRenderer.removeListener(channels.buildLog, listener);
  }
});

contextBridge.exposeInMainWorld('engineApi', engineApi);
