'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package and lock versions are the single synchronized release version', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  assert.equal(packageJson.version, '1.1.0');
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(packageJson.name, 'vofa-justfloat-engine-config');
  assert.equal(packageLock.name, packageJson.name);
});

test('renderer uses Fluent confirmation, Word tree, and offline three-language generation', () => {
  const html = read('src/renderer/index.html');
  const renderer = read('src/renderer/renderer.js');
  const styles = read('src/renderer/styles.css');

  assert.match(html, /id="confirm-dialog"/);
  assert.match(html, /id="generate-descriptions"/);
  assert.match(html, /role="treegrid"/);
  assert.doesNotMatch(renderer, /window\.confirm/);
  assert.match(renderer, /function showConfirmDialog/);
  assert.match(renderer, /function generateDescriptionsFromLayout/);
  assert.match(renderer, /word-tree-row/);
  assert.match(renderer, /channel-tree-row/);
  assert.match(styles, /\.confirm-dialog/);
  assert.match(styles, /\.word-tree-toggle/);
});

test('tag workflow publishes setup and portable zip but not the portable folder', () => {
  const workflow = read('.github/workflows/release.yml');
  const packageScript = read('scripts/package_windows.js');

  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.match(workflow, /dist\/\*_portable\.zip/);
  assert.match(workflow, /dist\/\*_setup\.exe/);
  assert.doesNotMatch(workflow, /dist\/\*_portable\//);
  assert.match(packageScript, /_portable`/);
  assert.match(packageScript, /_portable\.zip`/);
  assert.match(packageScript, /_setup\.exe`/);
});
