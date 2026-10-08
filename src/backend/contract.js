'use strict';

const channels = Object.freeze({
  getAppInfo: 'app:info',
  getEnvironment: 'environment:get',
  openConfig: 'config:open',
  saveConfig: 'config:save',
  selectPath: 'path:select',
  generate: 'engine:generate',
  previewFrame: 'engine:preview-frame',
  build: 'engine:build',
  openGenerated: 'generated:open',
  buildLog: 'build:log',
  checkUpdate: 'app:check-update',
  openExternal: 'shell:open-external'
});


const argumentCounts = Object.freeze({ getEnvironment: 1, openConfig: 1, saveConfig: 2, selectPath: 1, generate: 2, previewFrame: 2, build: 2, openGenerated: 1, checkUpdate: 0, openExternal: 1, getAppInfo: 0 });
module.exports = { channels, argumentCounts };
