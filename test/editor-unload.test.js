'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function editor() {
  const listeners = new Map(), events = new Map(), timers = new Map();
  const initial = [{ id: 'root', type: 'tab', label: 'Test' }, { id: 'word', type: 'vofa-word', name: 'Word 0', x: 320, y: 160 }];
  let nodes = structuredClone(initial), upstreamDirty = false, timerId = 0, modifications = 0;
  const parent = { postMessage() {} };
  const window = { parent, addEventListener(name, handler, options) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push({ handler, capture: options === true || options?.capture === true });
  } };
  // The upstream deployment guard is deliberately still dirty after a host save.
  window.addEventListener('beforeunload', (event) => {
    if (upstreamDirty) { event.preventDefault(); event.stopImmediatePropagation(); event.returnValue = 'undeployed'; }
  });
  const RED = {
    i18n: {}, comms: {}, init() {}, loader: { end() {} },
    nodes: { createCompleteNodeSet: () => nodes, clear() { nodes = []; }, import(next) { nodes = structuredClone(next); upstreamDirty = true; }, dirty(value) { upstreamDirty = value; } },
    history: { push() {}, pop() {}, clear() {} },
    workspaces: { show() {} }, view: { redraw() {} }, sidebar: { removeTab() {} }, actions: { invoke() {} },
    events: { on: (name, handler) => events.set(name, handler) }
  };
  const $ = { ajaxTransport() {}, ajax() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/node-red/editor.js'), 'utf8'), {
    window, RED, $, VofaNodeDefinitions: [], document: { getElementById: () => null },
    requestAnimationFrame: (fn) => fn(), setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id)
  });
  function receive(type, extra = {}) {
    for (const entry of listeners.get('message')) entry.handler({ source: parent, data: { channel: 'vofa-node-red', type, ...extra } });
  }
  receive('bootstrap', { scene: { version: 2, kind: 'fixed', byteOrder: 'little', flows: initial }, dirty: false });
  events.get('flows:loaded')();
  return {
    receive,
    modify() { nodes[1].name = `Changed ${++modifications}`; upstreamDirty = true; events.get('nodes:change')(); },
    resizeNode() { nodes[1].x += 40; },
    moveNode() { nodes[1].x += 40; RED.history.push({ type: 'move' }); },
    flush() { for (const fn of timers.values()) fn(); timers.clear(); },
    unload() {
      let prevented = false, stopped = false;
      const event = { preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; }, returnValue: undefined };
      for (const entry of [...listeners.get('beforeunload')].sort((a, b) => Number(b.capture) - Number(a.capture))) {
        entry.handler(event); if (stopped) break;
      }
      return prevented;
    }
  };
}

test('clean editor unloads and local edits are protected before the publish debounce', () => {
  const instance = editor();
  assert.equal(instance.unload(), false);
  instance.modify();
  assert.equal(instance.unload(), true);
  instance.flush();
  assert.equal(instance.unload(), true);
});

test('successful host save permits unloading even when Node-RED is still undeployed', () => {
  const instance = editor();
  instance.modify(); instance.flush();
  instance.receive('document-state', { dirty: true });
  assert.equal(instance.unload(), true);
  instance.receive('document-state', { dirty: false, savedRevision: 1 });
  assert.equal(instance.unload(), false);
  instance.modify();
  assert.equal(instance.unload(), true);
});

test('save acknowledges only the editor snapshot received by the host', () => {
  const instance = editor();
  instance.modify();
  // A save can finish before the debounced canvas change reaches the host.
  instance.receive('document-state', { dirty: false, savedRevision: 0 });
  assert.equal(instance.unload(), true);
  instance.flush();
  // The host's older acknowledgement must also preserve newer queued edits.
  instance.receive('document-state', { dirty: false, savedRevision: 0 });
  assert.equal(instance.unload(), true);
});

test('automatic label positioning is clean while an explicit move remains protected', () => {
  const instance = editor();
  instance.resizeNode();
  assert.equal(instance.unload(), false);
  instance.moveNode();
  assert.equal(instance.unload(), true);
  instance.flush();
  assert.equal(instance.unload(), true);
  instance.receive('document-state', { dirty: false, savedRevision: 1 });
  assert.equal(instance.unload(), false);
});

test('workbench edits and replacement configs follow the host document state', () => {
  const instance = editor();
  instance.receive('document-state', { dirty: true });
  assert.equal(instance.unload(), true);
  instance.receive('bootstrap', { scene: { version: 2, kind: 'fixed', byteOrder: 'little', flows: [{ id:'new', type:'tab' }] }, dirty: false });
  assert.equal(instance.unload(), false);
});
