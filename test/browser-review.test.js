'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { startBrowserReview } = require('../scripts/browser_review');
const { createBackendService } = require('../src/backend/service');
const root = path.resolve(__dirname, '..');

test('Bridge requires explicit development and is absent from production packaging', async () => {
  await assert.rejects(startBrowserReview(), /only in development/);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { await assert.rejects(startBrowserReview({ development: true }), /only in development/); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  const manifest = require('../package.json');
  assert.ok(!manifest.build.files.some((pattern) => pattern.startsWith('scripts')));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'), /browser_review|node:http|listen\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8'), /browser_review|__review/);
});

test('real Bridge enforces host/origin/token/contract and round-trips a real saved file', async (t) => {
  const bridge = await startBrowserReview({ development: true });
  t.after(() => bridge.close());
  const htmlResponse = await fetch(`${bridge.origin}/src/renderer/index.html`);
  const html = await htmlResponse.text();
  assert.ok(html.includes('/__review/client.js'));
  const token = html.match(/name="browser-review-token" content="([a-f0-9]+)"/)[1];
  const call = async (route, body, override = {}) => fetch(`${bridge.origin}/api/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: bridge.origin, 'X-Review-Token': token, ...override }, body: JSON.stringify(body)
  });
  assert.equal((await call('call', { method: 'getAppInfo', args: [] }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await call('call', { method: 'getAppInfo', args: [] }, { 'X-Review-Token': '' })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const request = http.request(`${bridge.origin}/api/call`, { method: 'POST', headers: { Host: 'untrusted.example' } }, (response) => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject); request.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await call('call', { method: 'constructor', args: [] })).status, 400);
  assert.equal((await call('call', { method: 'getAppInfo', args: [1] })).status, 400);
  assert.equal((await fetch(`${bridge.origin}/package.json`)).status, 404);
  const info = await (await call('call', { method: 'getAppInfo', args: [] })).json();
  assert.deepEqual(info.result, { version: require('../package.json').version, mode: 'browser-review' });
  const testDirectory = fs.mkdtempSync(path.join(root, 'scratch', 'bridge-test-'));
  t.after(() => fs.rmSync(testDirectory, { recursive: true, force: true }));
  const config = { version: 2, engineName: 'Bridge Roundtrip', wordCount: 1, fields: [{ wordIndex: 0, bitOffset: 0, type: 'float', name: 'value' }] };
  const file = path.join(testDirectory, 'saved.json');
  const save = call('call', { method: 'saveConfig', args: [config, null] });
  let prompt;
  for (let attempt = 0; attempt < 10 && !prompt; attempt++) {
    const events = await (await call('events', { after: 0 })).json();
    prompt = events.prompts[0];
  }
  assert.equal(prompt.kind, 'save');
  await call('dialog', { id: prompt.id, canceled: false, value: file });
  assert.equal((await (await save).json()).result.filePath, file);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).engineName, config.engineName);
  const open = call('call', { method: 'openConfig', args: [null] });
  prompt = null;
  for (let attempt = 0; attempt < 10 && !prompt; attempt++) prompt = (await (await call('events', { after: 0 })).json()).prompts[0];
  await call('dialog', { id: prompt.id, canceled: false, value: file });
  const opened = await (await open).json();
  assert.equal(opened.result.config.engineName, config.engineName);
  assert.equal(opened.result.config.fields[0].name, 'value');
});

test('review URLs declare Bridge and reject unsupported or ambiguous transport selection', async (t) => {
  const bridge = await startBrowserReview({ development: true });
  t.after(() => bridge.close());
  assert.equal(bridge.reviewUrl, `${bridge.origin}/?transport=bridge`);
  for (const entry of ['/', '/src/renderer/index.html']) {
    const response = await fetch(`${bridge.origin}${entry}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/src/renderer/index.html?transport=bridge');
  }
  const selected = await fetch(bridge.reviewUrl);
  assert.equal(selected.status, 200);
  assert.equal(new URL(selected.url).searchParams.get('transport'), 'bridge');
  assert.ok((await selected.text()).includes('name="browser-review-transport" content="bridge"'));
  for (const query of ['transport=mock', 'transport=native', 'transport=unknown', 'transport=', 'transport=bridge&transport=mock']) {
    const response = await fetch(`${bridge.origin}/?${query}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'UNSUPPORTED_TRANSPORT');
  }
});

test('Backend Service rejects invalid path kinds, forged environment keys and invalid external URLs', async () => {
  const backend = createBackendService({ mode: 'test' });
  await assert.rejects(backend.invoke('selectPath', ['arbitrary-file']), /kind must/);
  await assert.rejects(backend.invoke('getEnvironment', [{ repoRoot: root, arbitrary: true }]), /unsupported field/);
  await assert.rejects(backend.invoke('openExternal', ['file:///secret']), /unsafe external URL/);
  await assert.rejects(backend.invoke('openExternal', ['https://github.com/loogg/vofa-justfloat-engine-config-evil']), /unsafe external URL/);
});
