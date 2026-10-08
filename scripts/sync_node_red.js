'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/@node-red/editor-client');
const target = path.join(root, 'src/renderer/node-red/vendor');
const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
if (metadata.version !== require('../package.json').devDependencies['@node-red/editor-client']) throw new Error('Node-RED editor version must match the pinned dependency');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(source, 'public'), target, { recursive: true });
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
const catalogs = {};
for (const language of ['en-US', 'zh-CN']) {
  catalogs[language] = {};
  for (const namespace of ['editor', 'infotips', 'jsonata']) catalogs[language][namespace] = JSON.parse(fs.readFileSync(path.join(source, 'locales', language, `${namespace}.json`), 'utf8'));
  catalogs[language]['node-red'] = {};
}
fs.writeFileSync(path.join(target, 'locales.js'), `window.VofaNodeRedMessages = ${JSON.stringify(catalogs)};\n`, 'utf8');
fs.writeFileSync(path.join(target, 'version.json'), JSON.stringify({ version: metadata.version, license: metadata.license }));
console.log(`Node-RED editor ${metadata.version} assets synchronized`);
