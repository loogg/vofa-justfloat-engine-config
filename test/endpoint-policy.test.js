'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const policy = require('../src/renderer/node-red/endpoint-policy');

function canvas() {
  let nodes = [
    { id: 'receive', type: 'vofa-receive', z: 'root', framing: 'fixed' },
    { id: 'word', type: 'vofa-word', z: 'root' },
    { id: 'output', type: 'vofa-output', z: 'root' }
  ];
  let selection = {}, clipboard = ['existing'], history = [], calls = 0;
  const actions = new Map(), notices = [];
  const remove = () => {
    calls++;
    const removed = selection.nodes || [];
    history.push(removed);
    nodes = nodes.filter((node) => !removed.includes(node));
    selection = {};
  };
  const copy = () => { calls++; clipboard = (selection.nodes || []).map((node) => node.id); };
  actions.set('core:delete-selection', remove);
  actions.set('core:delete-selection-and-reconnect', remove);
  actions.set('core:cut-selection-to-internal-clipboard', () => { copy(); remove(); });
  actions.set('core:copy-selection-to-internal-clipboard', copy);
  actions.set('core:convert-to-subflow', remove);
  const RED = {
    nodes: { filterNodes: (filter) => nodes.filter((node) => Object.entries(filter).every(([key, value]) => node[key] === value)) },
    actions: { get: (name) => actions.get(name), remove: (name) => actions.delete(name), add: (name, fn) => actions.set(name, fn) },
    view: { selection: () => selection, select: (next) => { selection = next; } },
    group: { getNodes: (group) => group.children }, notify: (message) => notices.push(message)
  };
  policy.install(RED);
  return {
    RED, notices, node: (id) => nodes.find((node) => node.id === id),
    select: (...ids) => { selection = { nodes: ids.map((id) => nodes.find((node) => node.id === id)) }; },
    invoke: (name) => actions.get('core:' + name)(), add: (node) => nodes.push(node),
    undo: () => { nodes.push(...history.pop()); },
    state: () => ({ nodes: nodes.map((node) => node.id), clipboard, selection, history, calls })
  };
}

test('deleting or cutting a required endpoint leaves the canvas, clipboard and undo history unchanged', () => {
  for (const id of ['receive', 'output']) for (const action of ['delete-selection', 'delete-selection-and-reconnect', 'cut-selection-to-internal-clipboard']) {
    const instance = canvas(); instance.select(id); instance.invoke(action);
    assert.deepEqual(instance.state().nodes, ['receive', 'word', 'output']);
    assert.deepEqual(instance.state().clipboard, ['existing']);
    assert.equal(instance.state().history.length, 0);
    assert.equal(instance.state().calls, 0);
    assert.equal(instance.notices.length, 1);
  }
});

test('batch delete and cut affect only intermediate nodes, and undo never recreates endpoints', () => {
  for (const action of ['delete-selection', 'delete-selection-and-reconnect', 'cut-selection-to-internal-clipboard']) {
    const instance = canvas(); instance.select('receive', 'word', 'output'); instance.invoke(action);
    assert.deepEqual(instance.state().nodes, ['receive', 'output']);
    assert.deepEqual(instance.state().history[0].map((node) => node.id), ['word']);
    if (action.includes('cut')) assert.deepEqual(instance.state().clipboard, ['word']);
    instance.undo();
    assert.equal(instance.state().nodes.filter((id) => id === 'receive').length, 1);
    assert.equal(instance.state().nodes.filter((id) => id === 'output').length, 1);
    assert.ok(instance.node('word'));
  }
});

test('copy excludes protected endpoints and restores the original selection without changing document history', () => {
  const instance = canvas(); instance.select('receive', 'word', 'output'); instance.invoke('copy-selection-to-internal-clipboard');
  assert.deepEqual(instance.state().clipboard, ['word']);
  assert.deepEqual(instance.state().selection.nodes.map((node) => node.id), ['receive', 'word', 'output']);
  assert.equal(instance.state().history.length, 0);
  assert.equal(instance.notices.length, 0);
});

test('extra imported endpoints remain removable, and missing endpoints become available in the palette', () => {
  const instance = canvas(); instance.add({ id: 'extra', type: 'vofa-output', z: 'root' });
  assert.equal(policy.isProtected(instance.RED, instance.node('output')), true);
  assert.equal(policy.isProtected(instance.RED, instance.node('extra')), false);
  instance.select('extra'); instance.invoke('delete-selection');
  assert.ok(instance.node('output')); assert.equal(instance.node('extra'), undefined);
  assert.equal(policy.hasEndpoint(instance.RED, 'vofa-receive', 'root'), true);
  assert.equal(policy.hasEndpoint(instance.RED, 'vofa-receive', 'empty'), false);
});

test('groups containing required endpoints are protected while ordinary nodes still delegate to Node-RED', () => {
  const instance = canvas(); instance.add({ id: 'group', type: 'group', children: [instance.node('receive')] });
  instance.select('group', 'word'); instance.invoke('delete-selection');
  assert.ok(instance.node('group')); assert.ok(instance.node('receive')); assert.equal(instance.node('word'), undefined);
});

test('repeated initialization does not wrap actions again', () => {
  const instance = canvas(); policy.install(instance.RED); instance.select('receive'); instance.invoke('delete-selection');
  assert.equal(instance.notices.length, 1); assert.equal(instance.state().calls, 0);
});

test('converting a selection to a subflow cannot move required endpoints off the main canvas', () => {
  const instance = canvas(); instance.select('receive', 'word', 'output'); instance.invoke('convert-to-subflow');
  assert.deepEqual(instance.state().nodes, ['receive', 'word', 'output']);
  assert.equal(instance.state().history.length, 0); assert.equal(instance.state().calls, 0);
});
