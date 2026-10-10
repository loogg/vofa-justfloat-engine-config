'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../src/protocol');
const flow = require('../src/protocol-flow');
const generator = require('../src/generator');
const { createBackendService } = require('../src/backend/service');
const config = (dataFields, extra = {}) => ({
  version: 3, engineName: 'Validated Sensor', wordCount: 1, fields: [],
  protocol: { ...model.defaults('custom'), dataFields, crc: { algorithm: 'none', scope: 'data', byteOrder: 'little' }, ...extra }
});

test('equal-width header alternatives match independently and preserve an unfinished header', () => {
  const c = config([{ type: 'uint8', name: 'value' }], { headerValues: ['AA55', 'AA56'], tail: '0D0A' });
  const result = model.preview(c, 'AA 55 01 0D 0A AA 56 02 0D 0A AA');
  assert.deepEqual(result.frames.map((frame) => frame.channels[0].value), [1, 2]);
  assert.equal(result.remainingBytes, 1);
  for (const headerValues of [['AA55', 'AA'], ['AA55', 'AA55'], ['AA55', '']]) assert.ok(model.validate({ ...c, protocol: { ...c.protocol, headerValues } }).length);
});

test('value rejection retries one byte after the start and can recover overlapping headers', () => {
  const c = config([{ type: 'uint8', name: 'address', output: false }, { type: 'uint8', name: 'value' }], { header: 'AAAA', checks: [{ field: 0, operator: 'eq', values: [1] }] });
  assert.equal(model.layout(c).frameBytes, 4);
  const result = model.preview(c, 'AA AA AA 01 2A');
  assert.equal(result.frames[0].start, 1);
  assert.deepEqual(result.frames[0].channels.map((channel) => channel.value), [42]);
  assert.equal(result.rejected, 1);
  assert.equal(result.checkFailure.actual, 170);
});

test('an already false condition rejects before full length while a valid partial frame is retained', () => {
  const c = config([{ type: 'uint8', name: 'address', output: false }, { type: 'uint32', name: 'value' }], { header: 'AAAA', tail: '0D0A', checks: [{ field: 0, operator: 'eq', values: [1] }] });
  const result = model.preview(c, 'AA AA FF AA AA 01');
  assert.equal(result.consumedBytes, 3);
  assert.equal(result.remainingBytes, 3);
  assert.equal(result.frames.length, 0);
  assert.equal(result.rejected, 1);
});

test('headerless fixed frames use a known tail offset and raw checks to recover from noise', () => {
  const c = config([{ type: 'uint8', name: 'address', output: false }, { type: 'uint16', name: 'sample' }], { header: '', tail: '0D0A', checks: [{ field: 0, operator: 'in', values: [1, 2] }] });
  const result = model.preview(c, '99 01 34 12 0D 0A 02 78 56 0D 0A 01 34');
  assert.deepEqual(result.frames.map((frame) => frame.channels[0].value), [4660, 22136]);
  assert.equal(result.remainingBytes, 2);
  assert.ok(model.validate({ ...c, protocol: { ...c.protocol, tail: '' } }).length);
});

test('uint32 checks use the original value before float output rounds it', () => {
  const c = config([{ type: 'uint32', name: 'counter' }], { checks: [{ field: 0, operator: 'eq', values: [16777217] }] });
  const result = model.preview(c, 'AA 55 01 00 00 01');
  assert.equal(result.frames[0].channels[0].rawValue, 16777217);
  assert.equal(result.frames[0].channels[0].value, 16777216);
  assert.equal(model.preview(c, 'AA 55 00 00 00 01').frames.length, 0);
});

test('signed ranges, unsigned masks and float comparisons share sample and parser semantics', () => {
  const c = config([{ type: 'int16', name: 'signed' }, { type: 'uint8', name: 'flags' }, { type: 'float', name: 'value' }], { checks: [
    { field: 0, operator: 'range', min: -3, max: -1 },
    { field: 1, operator: 'mask', mask: 0xf0, value: 0xa0 },
    { field: 2, operator: 'eq', values: [0.1] }
  ] });
  assert.equal(model.preview(c, '').frames.length, 1);
  assert.equal(model.preview(c, 'AA 55 FE FF A3 CD CC CC 3D').frames.length, 1);
  assert.equal(model.preview(c, 'AA 55 FE FF B3 CD CC CC 3D').frames.length, 0);
  for (const check of [{ field: 5, operator: 'eq', values: [1] }, { field: 0, operator: 'mask', mask: 1, value: 1 }, { field: 1, operator: 'eq', values: [256] }, { field: 1, operator: 'range', min: 2, max: 1 }]) assert.ok(model.validate({ ...c, protocol: { ...c.protocol, checks: [check] } }).length);
});

test('tail-delimited Word frames allow short mapped prefixes, appended Words and partial tails', () => {
  const c = { version: 3, engineName: 'Tail Sensor', wordCount: 2, fields: [{ wordIndex: 0, type: 'uint32', bitOffset: 0, name: 'counter' }], protocol: { ...model.defaults(), kind: 'delimited', header: '', tail: '0000807F', repeatWords: true, crc: { algorithm: 'none', scope: 'data', byteOrder: 'little' } } };
  const result = model.preview(c, '01 00 00 00 00 00 80 7F 02 00 00 00 00 00 20 40 00 00 C0 3F 00 00 80 7F 03 00 00 00 00 00 80');
  assert.deepEqual(result.frames.map((frame) => frame.channels.map((channel) => channel.value)), [[1], [2, 2.5, 1.5]]);
  assert.equal(result.remainingBytes, 7);
  c.protocol.checks = [{ field: 1, operator: 'range', min: 0, max: 10 }];
  assert.equal(model.preview(c, '01 00 00 00 00 00 80 7F').frames.length, 0);
});

test('sample generation satisfies simultaneous masks and ranges rather than testing only endpoints', () => {
  const c = config([{ type: 'uint8', name: 'flags' }], { checks: [{ field: 0, operator: 'range', min: 13, max: 20 }, { field: 0, operator: 'mask', mask: 15, value: 2 }] });
  assert.equal(model.preview(c, '').frames[0].channels[0].value, 18);
  c.protocol.checks = [{ field: 0, operator: 'mask', mask: 0xf0, value: 0xa0 }, { field: 0, operator: 'mask', mask: 0x0f, value: 3 }];
  assert.equal(model.preview(c, '').frames[0].channels[0].value, 0xa3);
  c.protocol.checks.push({ field: 0, operator: 'eq', values: [1] });
  assert.throws(() => model.makeSample(c), /互相冲突/);
  // Actual input still receives a useful check failure, independently of sample generation.
  assert.equal(model.preview(c, 'AA 55 A3').checkFailure.operator, 'eq');
});

test('the delimited frame size limit includes its header and tail', () => {
  const c = { version: 3, engineName: 'Bounded Stream', wordCount: 1, fields: [], protocol: { ...model.defaults(), kind: 'delimited', tail: '0000807F', repeatWords: true, crc: { algorithm: 'none', scope: 'data', byteOrder: 'little' } } };
  const oversized = new Uint8Array(65538); oversized.set([0xaa, 0x55]); oversized.set([0, 0, 0x80, 0x7f], oversized.length - 4);
  assert.equal(model.preview(c, model.hex(oversized)).frames.length, 0);
});

test('new canvas checks refer to preceding fields and do not occupy bytes or require output channels', () => {
  const c = config([{ type: 'uint8', name: 'address', output: false }, { type: 'word', name: 'packed', mappings: [{ type: 'uint16', name: 'code', bitOffset: 8, output: false }, { type: 'uint8', name: 'value', bitOffset: 0 }] }], { checks: [{ field: 0, operator: 'eq', values: [1] }, { field: 1, operator: 'in', values: [16, 32] }] });
  const scene = flow.seed(c), compiled = flow.compile(scene);
  assert.equal(compiled.valid, true, compiled.errors.join('; '));
  assert.deepEqual(compiled.config.protocol.checks, c.protocol.checks);
  assert.equal(model.layout(compiled.config).frameBytes, 7);
  assert.equal(model.outputs(compiled.config).length, 1);
  assert.equal(flow.checkSources(scene, 'check-1').length, 3);
  scene.flows.find((node) => node.id === 'check-0').source = 'field-1#0';
  assert.equal(flow.compile(scene).valid, false);
});

test('legacy JustFloat previews preserve invalid-boundary consumption, short Words and images', async () => {
  const c = { version: 2, engineName: 'Legacy Preview', wordCount: 2, fields: [{ wordIndex: 0, type: 'uint8', bitOffset: 0, name: 'address' }] };
  const service = createBackendService({ mode: 'test' });
  assert.deepEqual((await service.invoke('previewFrame', [c, '01 00 00 00 00 00 80 7F'])).frames[0].channels.map((channel) => channel.value), [1]);
  const bad = model.previewJustFloat(c, '99 01 00 00 00 00 00 80 7F');
  assert.equal(bad.rejected, 1); assert.equal(bad.consumedBytes, 9);
  const image = '00 00 00 00 02 00 00 00 01 00 00 00 02 00 00 00 00 00 00 00 00 00 80 7F 00 00 80 7F AA BB';
  assert.equal(model.previewJustFloat(c, image).frames[0].imageSize, 2);
  assert.equal(model.previewJustFloat(c, image.slice(0, -3)).consumedBytes, 0);
  assert.equal(generator.validateConfig({ ...c, canvas: flow.seed(c) }).valid, true);
});

test('Word schema normalization, canvas migration and Backend preview preserve muted raw fields', async () => {
  const c = { version: 3, engineName: 'Muted Word', wordCount: 2, fields: [{ wordIndex: 0, type: 'uint8', bitOffset: 0, name: 'address', output: false }, { wordIndex: 1, type: 'float', bitOffset: 0, name: 'sample' }], protocol: { ...model.defaults(), crc: { algorithm: 'none', scope: 'data', byteOrder: 'little' }, checks: [{ field: 0, operator: 'eq', values: [1] }] } };
  const normalized = generator.normalizeConfig(c);
  assert.equal(normalized.fields[0].output, false);
  const compiled = flow.compile(flow.seed(normalized));
  assert.equal(compiled.valid, true, compiled.errors.join('; '));
  assert.equal(compiled.config.protocol.dataMode, 'custom');
  assert.equal(model.outputs(compiled.config).length, 1);
  const service = createBackendService({ mode: 'test' });
  assert.deepEqual((await service.invoke('previewFrame', [c, 'AA 55 01 00 00 00 00 00 20 40'])).frames[0].channels.map((channel) => channel.value), [2.5]);
  c.fields[0].output = 'false';
  assert.equal(generator.validateConfig(c).valid, false);
});

test('Word checks bind to the intended field across nonphysical edit order, reordering and deletion', () => {
  const c = { version: 3, engineName: 'Mapped Check', wordCount: 1, fields: [{ wordIndex: 0, type: 'uint16', bitOffset: 16, name: 'high' }, { wordIndex: 0, type: 'uint16', bitOffset: 0, name: 'low' }], protocol: { ...model.defaults(), crc: { algorithm: 'none', scope: 'data', byteOrder: 'little' } } };
  const scene = flow.seed(c), word = scene.flows.find((node) => node.id === 'words-0');
  word.wires = [['high-check']];
  scene.flows.push({ id: 'high-check', z: flow.ROOT, type: 'vofa-check', x: 700, y: 160, source: 'words-0#0', operator: 'eq', values: '16', wires: [['output']] });
  const compiled = flow.compile(scene);
  assert.equal(compiled.valid, true, compiled.errors.join('; '));
  assert.equal(compiled.config.protocol.checks[0].field, 1);
  assert.deepEqual(model.preview(compiled.config, 'AA 55 01 00 10 00').frames[0].channels.map((field) => field.value), [1, 16]);
  assert.equal(model.preview(compiled.config, 'AA 55 10 00 01 00').frames.length, 0);
  word.mappings.reverse();
  assert.equal(flow.compile(scene).config.protocol.checks[0].field, 1);
  word.mappings = word.mappings.filter((field) => field.name !== 'high');
  assert.equal(flow.compile(scene).valid, false);
});
