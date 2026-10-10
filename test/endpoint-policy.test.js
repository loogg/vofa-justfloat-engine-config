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
  let selection = {}, clipboard = ['existing'], history = [], calls = 0, system = false, searchOptions = null, importedOptions = null;
  const links = [];
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
    nodes: {
      filterNodes: (filter) => nodes.filter((node) => Object.entries(filter).every(([key, value]) => node[key] === value)),
      add(node) { nodes.push(node); return node; },
      import(input, options) { importedOptions = options; input.forEach((node) => RED.nodes.add(node)); return { nodes: input }; },
      addLink(link) { links.push(link); }
    },
    workspaces: { active: () => 'root' },
    typeSearch: { show(options) { searchOptions = options; }, refresh(options) { searchOptions = options; } },
    actions: { get: (name) => actions.get(name), remove: (name) => actions.delete(name), add: (name, fn) => actions.set(name, fn) },
    view: { selection: () => selection, select: (next) => { selection = next; } },
    group: { getNodes: (group) => group.children }, notify: (message) => notices.push(message)
  };
  policy.install(RED, { system: () => system });
  return {
    RED, notices, node: (id) => nodes.find((node) => node.id === id),
    select: (...ids) => { selection = { nodes: ids.map((id) => nodes.find((node) => node.id === id)) }; },
    invoke: (name) => actions.get('core:' + name)(), add: (node) => nodes.push(node),
    system(fn) { system = true; try { return fn(); } finally { system = false; } },
    undo: () => { nodes.push(...history.pop()); },
    state: () => ({ nodes: nodes.map((node) => node.id), clipboard, selection, history, calls, links, searchOptions, importedOptions })
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

test('copying only endpoints leaves the clipboard unchanged and explains the restriction', () => {
  const instance = canvas(); instance.select('receive', 'output'); instance.invoke('copy-selection-to-internal-clipboard');
  assert.deepEqual(instance.state().clipboard, ['existing']);
  assert.equal(instance.state().calls, 0); assert.match(instance.notices[0], /中间模块/);
});

test('extra endpoints in older drafts remain removable without deleting the required endpoint', () => {
  const instance = canvas(); instance.add({ id: 'extra', type: 'vofa-output', z: 'root' });
  assert.equal(policy.isProtected(instance.RED, instance.node('output')), true);
  assert.equal(policy.isProtected(instance.RED, instance.node('extra')), false);
  instance.select('extra'); instance.invoke('delete-selection');
  assert.ok(instance.node('output')); assert.equal(instance.node('extra'), undefined);
  assert.equal(policy.hasEndpoint(instance.RED, 'vofa-receive', 'root'), true);
  assert.equal(policy.hasEndpoint(instance.RED, 'vofa-receive', 'empty'), false);
});

test('interactive node creation cannot add endpoints but system load and history restoration can', () => {
  const instance = canvas();
  assert.throws(() => instance.RED.nodes.add({ id: 'duplicate', type: 'vofa-output', z: 'root' }), /自动创建/);
  assert.equal(instance.node('duplicate'), undefined);
  instance.RED.nodes.add({ id: 'field', type: 'vofa-uint8', z: 'root' });
  assert.ok(instance.node('field'));
  instance.system(() => instance.RED.nodes.add({ id: 'restored', type: 'vofa-output', z: 'root' }));
  assert.ok(instance.node('restored'));
});

test('pasting an entire foreign flow imports only intermediate nodes into the existing canvas', () => {
  const instance = canvas();
  const input = [
    { id: 'foreign', type: 'tab' },
    { id: 'r', type: 'vofa-receive', z: 'foreign', wires: [['a']] },
    { id: 'a', type: 'vofa-uint8', z: 'foreign', wires: [['b']] },
    { id: 'b', type: 'vofa-uint16', z: 'foreign', wires: [['o']] },
    { id: 'o', type: 'vofa-output', z: 'foreign' }
  ];
  const original = structuredClone(input);
  instance.RED.nodes.import(input, { addFlow: true, generateIds: true });
  assert.deepEqual(input, original);
  assert.deepEqual(instance.state().nodes, ['receive', 'word', 'output', 'a', 'b']);
  assert.equal(instance.node('a').z, 'root'); assert.deepEqual(instance.node('a').wires, [['b']]);
  assert.deepEqual(instance.node('b').wires, [[]]);
  assert.equal(instance.state().importedOptions.addFlow, false);
  assert.equal(instance.state().importedOptions.generateIds, true);
  assert.equal(instance.RED.nodes.import([{ id: 'new-end', type: 'vofa-output' }]), undefined);
});

test('search and continued quick add require both input and output ports', () => {
  const instance = canvas();
  for (const method of ['show', 'refresh']) {
    instance.RED.typeSearch[method]({ filter: { input: false, output: false }, x: 123 });
    assert.deepEqual(instance.state().searchOptions.filter, { input: true, output: true });
    assert.equal(instance.state().searchOptions.x, 123);
  }
});

test('module links stay after the receive endpoint and before the output endpoint', () => {
  const instance = canvas(), receive = instance.node('receive'), output = instance.node('output'), word = instance.node('word');
  for (const link of [{ source: output, target: word }, { source: word, target: receive }, { source: word, target: { id: 'other', type: 'vofa-word', z: 'another-flow' } }]) instance.RED.nodes.addLink(link);
  assert.equal(instance.state().links.length, 0);
  instance.RED.nodes.addLink({ source: receive, target: word });
  instance.RED.nodes.addLink({ source: word, target: output });
  assert.equal(instance.state().links.length, 2);
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
