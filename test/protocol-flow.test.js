'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const flow = require('../src/protocol-flow');
const model = require('../src/protocol');
const generator = require('../src/generator');
const { createBackendService } = require('../src/backend/service');
const base = () => ({ version: 3, engineName: 'Graph Sensor', wordCount: 2, fields: [], protocol: model.defaults(), descriptionAutoSync: true });

test('native Node-RED scenes compile to fixed protocol definitions and movement never changes length', () => {
  const scene = flow.seed(base());
  assert.equal(flow.compile(scene).valid, true);
  scene.flows.find((node) => node.id === 'header').y = 440;
  const config = generator.normalizeConfig({ ...base(), canvas: scene });
  assert.equal(model.layout(config).frameBytes, 12);
  assert.equal(config.canvas.flows.find((node) => node.id === 'header').y, 440);
});

test('primary canvas wires decide physical Word order and field output positions', () => {
  const scene = flow.seed(base());
  const first = scene.flows.find((node) => node.id === 'words-0'), second = scene.flows.find((node) => node.id === 'words-1');
  first.mappings = [{ type: 'uint8', bitOffset: 0, name: 'first' }];
  second.mappings = [{ type: 'uint16', bitOffset: 0, name: 'second' }];
  scene.flows.find((node) => node.id === 'header').wires = [[second.id]];
  second.wires = [[first.id]]; first.wires = [['crc']];
  const result = flow.compile(scene);
  assert.equal(result.valid, true);
  assert.deepEqual(result.config.fields.map((field) => [field.wordIndex, field.name]), [[0, 'second'], [1, 'first']]);
});

test('primary custom fields preserve exact widths, reserved bytes and byte order', () => {
  const config = base(); config.protocol = { ...model.defaults('custom'), byteOrder: 'big', dataFields: [{ type: 'uint8', name: 'a' }, { type: 'uint16', name: 'b' }, { type: 'reserved', name: '', bytes: 2 }, { type: 'float', name: 'c' }] };
  const result = flow.compile(flow.seed(config));
  assert.equal(result.valid, true);
  assert.equal(model.layout(result.config).dataBytes, 9);
  assert.equal(result.config.protocol.byteOrder, 'big');
});

test('native reroute junctions preserve byte order and reject branched junctions', () => {
  const scene = flow.seed(base());
  scene.flows.find((node) => node.id === 'words-1').wires = [['reroute']];
  scene.flows.push({ id: 'reroute', type: 'junction', z: flow.ROOT, x: 500, y: 240, wires: [['crc']] });
  assert.equal(model.layout(flow.compile(scene).config).frameBytes, 12);
  scene.flows.find((node) => node.id === 'reroute').wires[0].push('output');
  assert.equal(flow.compile(scene).valid, false);
});

test('data subflow boundary wires may end at a native reroute junction', () => {
  const scene = flow.seedLegacy(base());
  const definition = scene.flows.find((node) => node.id === 'vofa-data-words');
  scene.flows.find((node) => node.id === 'words-1').wires = [['data-reroute']];
  scene.flows.push({ id: 'data-reroute', type: 'junction', z: definition.id, x: 440, y: 160, wires: [[]] });
  definition.out[0].wires = [{ id: 'data-reroute', port: 0 }];
  assert.equal(flow.compile(scene).config.wordCount, 2);
  definition.out[0].wires = [{ id: 'words-0', port: 0 }];
  assert.equal(flow.compile(scene).valid, false);
});

test('complete JustFloat nodes retain the legacy parser strategy', () => {
  const legacy = { version: 2, engineName: 'Legacy Graph', wordCount: 2, fields: [{ wordIndex: 1, type: 'int16', bitOffset: 8, name: 'signed' }] };
  const result = generator.validateConfig({ ...legacy, canvas: flow.seed(legacy) });
  assert.equal(result.valid, true);
  assert.equal(result.config.version, 2);
  assert.equal(result.config.protocol, undefined);
  assert.deepEqual(result.config.fields, legacy.fields);
});

test('disconnected, branching, cyclic and invalid field-layout graphs block generation', () => {
  const changes = [
    (nodes) => { nodes.find((node) => node.id === 'header').wires = [[]]; },
    (nodes) => { nodes.find((node) => node.id === 'words-1').wires[0].push('output'); },
    (nodes) => { nodes.find((node) => node.id === 'crc').wires = [['data']]; },
    (nodes) => { nodes.find((node) => node.id === 'words-0').type = 'vofa-unknown'; },
    (nodes) => { nodes.find((node) => node.id === 'words-1').wires = [[]]; }
  ];
  for (const mutate of changes) {
    const scene = flow.seed(base()); mutate(scene.flows);
    assert.equal(generator.validateConfig({ ...base(), canvas: scene }).valid, false);
  }
});

test('unknown executable node types, duplicated identities and invalid coordinates are rejected', () => {
  const scene = flow.seed(base()); scene.flows[0].type = 'function';
  assert.throws(() => flow.normalize(scene), /节点类型/);
  const repeated = flow.seed(base()); repeated.flows.push({ ...repeated.flows[0] }); assert.throws(() => flow.normalize(repeated), /重复/);
  const position = flow.seed(base()); position.flows[1].x = Infinity; assert.throws(() => flow.normalize(position), /坐标/);
});

test('a disconnected canvas can be saved and reopened as a draft while build and preview stay blocked', async (t) => {
  const parent = path.resolve(__dirname, '../scratch/flow-tests'); fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'draft-')); t.after(() => { assert.equal(path.dirname(path.resolve(directory)), parent); fs.rmSync(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'draft.json');
  const service = createBackendService({ mode: 'test', getPath: () => directory, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: file }), showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } });
  const config = { ...base(), canvas: flow.seed(base()) }; config.canvas.flows.find((node) => node.id === 'words-1').wires = [[]];
  await service.invoke('saveConfig', [config, null]);
  const restored = await service.invoke('openConfig', [null]);
  assert.equal(restored.config.canvas.version, 3);
  assert.equal(flow.compile(restored.config.canvas).valid, false);
  await assert.rejects(service.invoke('previewFrame', [restored.config, '']), /Invalid engine configuration/);
});

test('new canvases contain one primary flow and preserve older nested configs when flattened', () => {
  const old = flow.seedLegacy(base()), compiled = flow.compile(old);
  const flat = flow.seed({ ...base(), ...compiled.config });
  assert.equal(flat.version, 3);
  assert.equal(flat.flows.some((node) => node.type === 'subflow' || node.type.startsWith('subflow:')), false);
  assert.deepEqual(flow.compile(flat).config, compiled.config);
});

test('Word and fixed-width fields may share the same primary frame chain', () => {
  const scene = flow.seed(base());
  scene.flows.find((node) => node.id === 'header').wires = [['state']];
  scene.flows.push({ id: 'state', type: 'vofa-uint8', name: 'state', z: flow.ROOT, x: 230, y: 160, wires: [['words-0']] });
  scene.flows.find((node) => node.id === 'words-0').mappings = [{ type: 'uint16', name: 'temperature', bitOffset: 0 }, { type: 'bit', name: 'ready', bitOffset: 31 }];
  const result = generator.validateConfig({ ...base(), canvas: scene });
  assert.equal(result.valid, true);
  assert.equal(result.config.protocol.dataMode, 'custom');
  assert.equal(model.layout(result.config).frameBytes, 13);
  assert.deepEqual(model.outputs(result.config).map((channel) => channel.offset), [0, 1, 4, 5]);
});
