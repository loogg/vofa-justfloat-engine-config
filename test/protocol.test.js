'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../src/protocol');
const generator = require('../src/generator');
const { createBackendService } = require('../src/backend/service');

function wordConfig() {
  return { version: 3, engineName: 'Fixed Sensor', wordCount: 2, fields: [], protocol: model.defaults(), descriptionAutoSync: true };
}
function customConfig(fields) {
  return { ...wordConfig(), fields: [], protocol: { ...model.defaults('custom'), dataFields: fields } };
}
function temporaryRepository(t) {
  const parent = path.resolve(__dirname, '../scratch/protocol-tests');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'repo-'));
  fs.cpSync(path.join(__dirname, 'fixtures/vofa-repository'), directory, { recursive: true });
  t.after(() => { assert.equal(path.dirname(path.resolve(directory)), parent); fs.rmSync(directory, { recursive: true, force: true }); });
  return directory;
}

test('CRC presets match published 123456789 check vectors including reflected and 32-bit profiles', () => {
  const expected = { 'crc8-smbus': 0xf4, 'crc8-maxim': 0xa1, 'crc16-modbus': 0x4b37, 'crc16-arc': 0xbb3d, 'crc16-xmodem': 0x31c3, 'crc16-ccitt-false': 0x29b1, 'crc32-iso': 0xcbf43926 };
  for (const [name, check] of Object.entries(expected)) assert.equal(model.calculateCrc(new TextEncoder().encode('123456789'), model.CRCS[name]), check, name);
});

test('custom CRC descriptions cannot retain a preset name after changing its parameters', () => {
  const config = wordConfig();
  config.protocol.crc = { algorithm: 'custom', scope: 'data', byteOrder: 'little', parameters: { ...model.CRCS['crc16-modbus'], polynomial: 0x1021 } };
  const normalized = generator.normalizeConfig(config);
  assert.equal(normalized.protocol.crc.parameters.label, undefined);
  assert.match(model.descriptions(normalized).English.format, /Custom CRC/);
  assert.doesNotMatch(model.descriptions(normalized).English.format, /MODBUS/);
});

test('fixed Word frames retain their configured length and map empty Words to float', () => {
  const config = generator.normalizeConfig(wordConfig());
  assert.equal(config.version, 3);
  assert.equal(model.layout(config).frameBytes, 12);
  const result = model.preview(config, 'AA 55 00 00 C0 3F 00 00 20 40 5D 3E');
  assert.equal(result.frames.length, 1);
  assert.deepEqual(result.frames[0].channels.map((c) => c.value), [1.5, 2.5]);
  const bad = model.preview(config, 'AA 55 00 00 C0 3F 00 00 20 41 5D 3E');
  assert.equal(bad.frames.length, 0);
  assert.ok(bad.crcFailure);
  assert.equal(model.layout(config).frameBytes, 12);
});

test('custom fields use their exact byte widths, explicit reserved bytes and signed decoding', () => {
  const config = customConfig([{ type: 'int16', name: 'temperature' }, { type: 'uint8', name: 'state' }, { type: 'reserved', name: '', bytes: 1 }, { type: 'float', name: 'speed' }]);
  config.protocol.crc.algorithm = 'none';
  const normalized = generator.normalizeConfig(config);
  const result = model.preview(normalized, 'AA 55 00 80 FF 00 00 00 20 40');
  assert.equal(result.frameBytes, 10);
  assert.deepEqual(result.frames[0].channels.map((c) => c.value), [-32768, 255, 2.5]);
  assert.equal(model.layout(generator.normalizeConfig(customConfig([{ type: 'uint8', name: 'a' }, { type: 'uint16', name: 'b' }, { type: 'float', name: 'c' }]))).dataBytes, 7);
});

test('a mapped Word embedded between custom fields consumes exactly four bytes', () => {
  const config = customConfig([{ type: 'uint8', name: 'state' }, { type: 'word', name: 'packed', mappings: [{ type: 'uint16', name: 'temperature', bitOffset: 0 }, { type: 'bit', name: 'ready', bitOffset: 31 }] }, { type: 'int16', name: 'signed' }]);
  config.protocol.crc.algorithm = 'none';
  const normalized = generator.normalizeConfig(config), result = model.preview(normalized, 'AA 55 07 34 12 56 80 FE FF');
  assert.equal(result.frameBytes, 9);
  assert.deepEqual(result.frames[0].channels.map((channel) => channel.value), [7, 4660, 1, -2]);
  config.protocol.dataFields[1].mappings.push({ type: 'uint8', name: 'overlap', bitOffset: 8 });
  assert.equal(generator.validateConfig(config).valid, false);
});

test('Word mappings stay at four bytes and bit mappings do not consume separate bytes', () => {
  const config = wordConfig();
  config.fields = [{ wordIndex: 0, type: 'uint16', bitOffset: 0, name: 'temperature' }, { wordIndex: 0, type: 'uint8', bitOffset: 16, name: 'state' }, { wordIndex: 0, type: 'bit', bitOffset: 31, name: 'ready' }];
  config.protocol.crc.algorithm = 'none';
  const normalized = generator.normalizeConfig(config);
  const result = model.preview(normalized, 'AA 55 34 12 56 80 00 00 20 40');
  assert.equal(result.frameBytes, 10);
  assert.deepEqual(result.frames[0].channels.map((c) => c.value), [4660, 86, 1, 2.5]);
});

test('big-endian data, 32-bit precision and custom bit containers decode explicitly', () => {
  const config = customConfig([{ type: 'int32', name: 'signed' }, { type: 'uint32', name: 'unsigned' }, { type: 'float', name: 'float' }, { type: 'bit', name: 'flag', bitOffset: 7 }]);
  config.protocol.byteOrder = 'big'; config.protocol.crc.algorithm = 'none';
  const result = model.preview(generator.normalizeConfig(config), 'AA 55 FF FF FF FC 01 00 00 01 40 20 00 00 80');
  assert.deepEqual(result.frames[0].channels.map((c) => c.rawValue), [-4, 16777217, 2.5, 1]);
  assert.equal(result.frames[0].channels[1].value, 16777216);
});

test('scanner handles noise, overlapping headers, CRC rejection, retained partial frames and concatenated frames', () => {
  const config = generator.normalizeConfig(wordConfig());
  const sample = model.makeSample(config);
  assert.equal(model.preview(config, sample.slice(0, 14)).frames.length, 0);
  const result = model.preview(config, `01 AA ${sample} ${sample} AA 55 00`);
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].start, 2);
  assert.equal(result.remainingBytes, 3);
  const bad = sample.replace('5D 3E', '00 00');
  assert.equal(model.preview(config, `${bad} ${sample}`).frames.length, 1);
});

test('scope, checksum byte order and tail are independent of data field values', () => {
  const config = customConfig([{ type: 'uint16', name: 'a' }]);
  config.protocol.tail = '0D0A'; config.protocol.crc.scope = 'header-data'; config.protocol.crc.byteOrder = 'big';
  const normalized = generator.normalizeConfig(config);
  assert.equal(model.preview(normalized, '').frames.length, 1);
  assert.equal(model.layout(normalized).frameBytes, 8);
  const frame = model.bytes(model.makeSample(normalized)); frame[frame.length - 1] = 0;
  assert.equal(model.preview(normalized, model.hex(frame)).frames.length, 0);
});

test('validation rejects unknown modes, malformed bytes, invalid fields and unsafe CRC parameters', () => {
  const invalid = [
    (c) => { c.protocol.header = ''; }, (c) => { c.protocol.header = 'A'; }, (c) => { c.protocol.tail = 'ZZ'; },
    (c) => { c.protocol.kind = 'dynamic'; }, (c) => { c.protocol.byteOrder = 'native'; },
    (c) => { c.protocol.crc.algorithm = '__proto__'; }, (c) => { c.version = 4; },
    (c) => { c.protocol.dataFields = [{ type: 'reserved', name: '', bytes: -1 }]; },
    (c) => { c.protocol.dataFields = [{ type: 'reserved', name: '', bytes: 1 }]; },
    (c) => { c.protocol.dataFields = [{ type: 'bit', name: 'a', bitOffset: 8 }]; },
    (c) => { c.protocol.dataFields = [{ type: 'unknown', name: 'a' }]; },
    (c) => { c.protocol.crc.algorithm = 'custom'; c.protocol.crc.parameters = { width: 16, polynomial: -1, init: 0, xorOut: 0, reflectInput: false, reflectOutput: false }; }
  ];
  for (const mutate of invalid) { const config = customConfig([{ type: 'uint8', name: 'a' }]); mutate(config); assert.equal(generator.validateConfig(config).valid, false, JSON.stringify(config)); }
  const overlap = wordConfig(); overlap.fields = [{ wordIndex: 0, type: 'float', bitOffset: 0, name: 'a' }, { wordIndex: 0, type: 'uint8', bitOffset: 0, name: 'b' }];
  assert.equal(generator.validateConfig(overlap).valid, false);
  assert.throws(() => model.bytes('AA GG'), /十六进制/);
});

test('fixed generation is separate from the preserved legacy JustFloat scanning path', (t) => {
  const repo = temporaryRepository(t);
  const result = generator.generateEngine(wordConfig(), { repoRoot: repo });
  const source = fs.readFileSync(result.sourceFile, 'utf8');
  assert.match(source, /FrameSize = 12/);
  assert.match(source, /end_index_/);
  assert.doesNotMatch(source, /0x7F800000/);
  const marker = JSON.parse(fs.readFileSync(path.join(result.sourceDirectory, '.vofa-engine-builder.json')));
  assert.deepEqual(marker.config.protocol, model.normalize(wordConfig().protocol));
  const old = { version: 2, engineName: 'Legacy Sensor', wordCount: 1, fields: [{ wordIndex: 0, type: 'float', bitOffset: 0, name: 'ch0' }] };
  const legacy = generator.generateEngine(old, { repoRoot: repo });
  assert.match(fs.readFileSync(legacy.sourceFile, 'utf8'), /0x7F800000/);
  assert.equal(generator.normalizeConfig(old).version, 2);
});

test('Backend Service saves and reloads complete schema v3 and previews through its restricted contract', async (t) => {
  const repo = temporaryRepository(t), file = path.join(repo, 'fixed.json');
  const service = createBackendService({ mode: 'test', getPath: () => repo, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: file }), showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } });
  const config = customConfig([{ type: 'uint16', name: 'temperature' }, { type: 'bit', name: 'ready', bitOffset: 3 }]);
  config.protocol.crc.algorithm = 'custom'; config.protocol.crc.parameters = { ...model.CRCS['crc16-xmodem'] };
  await service.invoke('saveConfig', [config, repo]);
  const loaded = await service.invoke('openConfig', [repo]);
  assert.equal(loaded.config.version, 3);
  assert.deepEqual(loaded.config.protocol, model.normalize(config.protocol));
  assert.equal((await service.invoke('previewFrame', [loaded.config, ''])).frames.length, 1);
  await assert.rejects(service.invoke('previewFrame', [config]), /Expected 2/);
  await assert.rejects(service.invoke('previewFrame', [config, 'GG']), /十六进制/);
});
