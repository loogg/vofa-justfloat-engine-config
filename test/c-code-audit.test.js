'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { generateEngine, normalizeConfig } = require('../src/generator');
const model = require('../src/protocol');

const workspace = path.resolve(__dirname, '../scratch/tests');
fs.mkdirSync(workspace, { recursive: true });
function repository(t) {
  const root = fs.mkdtempSync(path.join(workspace, 'vofa-c-audit-'));
  fs.cpSync(path.join(__dirname, 'fixtures/vofa-repository'), root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const field = (wordIndex, type, bitOffset, name = type) => ({ wordIndex, type, bitOffset, name });
const cases = [
  { name: 'AllFloat', words: 4, fields: [field(0, 'float', 0), field(1, 'float', 0)],
    bytes: '00 00 C0 3F 00 00 20 40 00 00 60 40 00 00 90 40', values: [1.5, 2.5, 3.5, 4.5] },
  { name: 'DenseMixed', words: 2, fields: [field(0, 'bit', 0), field(0, 'uint8', 8), field(0, 'int8', 16), field(0, 'bit', 24)],
    bytes: '01 7F 80 01 00 00 20 40', values: [1, 127, -128, 1, 2.5] },
  { name: 'Word16', words: 1, fields: [field(0, 'uint16', 0), field(0, 'int16', 16)],
    bytes: 'FF FF 00 80', values: [65535, -32768] },
  { name: 'Full32', words: 2, fields: [field(0, 'uint32', 0), field(1, 'int32', 0)],
    bytes: 'FF FF FF FF 00 00 00 80', values: [Math.fround(0xffffffff), -2147483648] },
  { name: 'Sparse', words: 4, fields: [field(0, 'uint8', 0), field(2, 'uint16', 0), field(2, 'uint16', 16)],
    bytes: '01 00 00 00 00 00 20 40 34 12 78 56 00 00 60 40 00 00 90 40', values: [1, 2.5, 4660, 22136, 3.5, 4.5] }
];

test('generated sample engines retain the Qt plugin contract and safe stream boundaries without image state', (t) => {
  const result = generateEngine({ version: 2, engineName: 'Tail Guard', wordCount: 4, fields: [field(0, 'float', 0)] }, { repoRoot: repository(t) });
  const header = fs.readFileSync(result.headerFile, 'utf8'), source = fs.readFileSync(result.sourceFile, 'utf8');
  assert.match(header, /#ifndef TAILGUARD_H/);
  assert.match(header, /class TailGuard\s*:\s*public QObject,\s*public DataEngineInterface/);
  assert.match(header, /Q_PLUGIN_METADATA\(IID "VOFA\+\.Plugin\.TailGuard"\)/);
  assert.match(header, /Q_INTERFACES\(DataEngineInterface\)/);
  assert.doesNotMatch(header + source, /image_count_mutation_count_|image_size_|这是个图片/);
  assert.match(source, /static_assert\(sizeof\(float\) == 4/);
  assert.match(source, /\(dataEnd - HeaderSize\) % 4 != 0/);
  assert.match(source, /end_index_ = position \+ frameSize - 1/);
  assert.match(source, /frame_list_\.clear\(\)/);
});

for (const entry of cases) test(`migrated ${entry.name} preserves signed, packed, short and later-Word sampling`, (t) => {
  const config = { version: 2, engineName: entry.name, wordCount: entry.words, fields: entry.fields };
  const canonical = normalizeConfig(config);
  const result = generateEngine(config, { repoRoot: repository(t) });
  assert.equal(JSON.parse(fs.readFileSync(result.configFile)).config.version, 3);
  assert.deepEqual(canonical.fields, entry.fields);
  const full = model.preview(canonical, entry.bytes + ' 00 00 80 7F');
  assert.deepEqual(full.frames[0].channels.map((channel) => channel.value), entry.values);
  const tailOnly = model.preview(canonical, '00 00 80 7F');
  assert.equal(tailOnly.frames[0].channels.length, 0);
  const short = model.preview(canonical, entry.bytes.split(' ').slice(0, 4).join(' ') + ' 00 00 80 7F');
  assert.ok(short.frames[0].channels.length <= entry.values.length);
  assert.deepEqual(short.frames[0].channels.map((channel) => channel.value), entry.values.slice(0, short.frames[0].channels.length));
});
