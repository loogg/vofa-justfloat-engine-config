'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildEngine, normalizeConfig } = require('../src/generator');
const model = require('../src/protocol');

const root = path.resolve(__dirname, '..');
const workspace = path.join(root, 'scratch/protocol-smoke');
const repo = path.join(workspace, 'repository');
fs.mkdirSync(workspace, { recursive: true });
const temporaryDirectory = path.join(workspace, 'temp');
fs.mkdirSync(temporaryDirectory, { recursive: true });
process.env.TEMP = temporaryDirectory;
process.env.TMP = temporaryDirectory;
fs.cpSync(path.join(root, 'test/fixtures/vofa-repository'), repo, { recursive: true });
const log = path.join(workspace, 'qt-build.log');
fs.writeFileSync(log, '');
const base = (engineName, protocol) => ({ version: 3, engineName, wordCount: 2, fields: [], protocol, descriptionAutoSync: true });
const runs = [];
const words = base('Protocol Words', model.defaults());
words.fields = [{ wordIndex: 0, type: 'uint16', bitOffset: 0, name: 'temperature' }, { wordIndex: 0, type: 'uint8', bitOffset: 16, name: 'state' }, { wordIndex: 0, type: 'bit', bitOffset: 31, name: 'ready' }, { wordIndex: 1, type: 'int32', bitOffset: 0, name: 'signed' }];
runs.push({ config: words, values: [4660, 86, 1, -4], payload: '34 12 56 80 FC FF FF FF' });
const custom = base('Protocol Custom', { ...model.defaults('custom'), byteOrder: 'big', tail: '0D0A', dataFields: [{ type: 'int16', name: 'signed' }, { type: 'uint32', name: 'precision' }, { type: 'reserved', name: '', bytes: 1 }, { type: 'float', name: 'float' }, { type: 'bit', name: 'flag', bitOffset: 7 }], crc: { algorithm: 'custom', scope: 'header-data', byteOrder: 'big', parameters: { ...model.CRCS['crc16-xmodem'] } } });
runs.push({ config: custom, values: [-32768, 16777216, 2.5, 1], payload: '80 00 01 00 00 01 00 40 20 00 00 80' });
const mixed = base('Protocol Mixed', { ...model.defaults('custom'), dataFields: [{ type: 'uint8', name: 'state' }, { type: 'word', name: 'packed', mappings: [{ type: 'uint16', name: 'temperature', bitOffset: 0 }, { type: 'bit', name: 'ready', bitOffset: 31 }] }, { type: 'int16', name: 'signed' }] });
runs.push({ config: mixed, values: [7, 4660, 1, -2], payload: '07 34 12 56 80 FE FF' });
const checks = { 'crc8-smbus': 0xf4, 'crc8-maxim': 0xa1, 'crc8-sae-j1850': 0x4b, 'crc16-modbus': 0x4b37, 'crc16-arc': 0xbb3d, 'crc16-xmodem': 0x31c3, 'crc16-ccitt-false': 0x29b1, 'crc32-iso': 0xcbf43926 };
for (const [algorithm, check] of Object.entries(checks)) {
  const p = model.defaults('custom'); p.crc.algorithm = algorithm; p.crc.byteOrder = 'big';
  p.dataFields = Array.from({ length: 9 }, (_, i) => ({ type: 'uint8', name: `ch${i}` }));
  runs.push({ config: base(`Protocol ${algorithm.replace(/-/g, ' ')}`, p), payload: '31 32 33 34 35 36 37 38 39', values: Array.from({ length: 9 }, (_, i) => 49 + i), check });
}
const none = model.defaults('custom'); none.crc.algorithm = 'none'; none.dataFields = [{ type: 'float', name: 'value' }];
runs.push({ config: base('Protocol No Crc', none), payload: '00 00 20 40', values: [2.5] });

async function main() {
  const summaries = [];
  for (const run of runs) {
    const config = normalizeConfig(run.config), l = model.layout(config);
    const frame = model.bytes(model.makeSample(config));
    frame.set(model.bytes(run.payload), l.dataOffset);
    const crc = run.check ?? model.calculateCrc(frame.subarray(config.protocol.crc.scope === 'data' ? l.dataOffset : 0, l.crcOffset), model.crcParameters(config.protocol.crc));
    for (let i = 0; i < l.crcBytes; i++) frame[l.crcOffset + i] = (crc >>> (8 * (config.protocol.crc.byteOrder === 'little' ? i : l.crcBytes - 1 - i))) & 0xff;
    const sample = model.hex(frame);
    const definition = { className: config.className, cases: [
      { hex: sample, channels: [run.values], consumed: frame.length },
      { hex: model.hex(frame.subarray(0, frame.length - 1)), channels: [], consumed: 0 },
      { hex: `${sample} ${sample} AA 55 00`, channels: [run.values, run.values], consumed: frame.length * 2 },
      { hex: `01 AA ${sample}`, channels: [run.values], consumed: frame.length + 2 }
    ] };
    if (l.crcBytes) {
      const bad = Uint8Array.from(frame); bad[l.crcOffset] ^= 0x01;
      definition.cases.push({ hex: model.hex(bad), channels: [], consumed: frame.length - 1 }, { hex: `${model.hex(bad)} ${sample}`, channels: [run.values], consumed: frame.length * 2 });
    }
    if (l.tailBytes) {
      const bad = Uint8Array.from(frame); bad[l.tailOffset] ^= 0xff;
      definition.cases.push({ hex: model.hex(bad), channels: [], consumed: frame.length - 1 });
    }
    const casesFile = path.join(workspace, `${config.targetName}-cases.json`);
    fs.writeFileSync(casesFile, JSON.stringify(definition, null, 2));
    console.log(`Qt Release build: ${config.displayName}`);
    const built = await buildEngine(config, { repoRoot: repo, onOutput: (output) => fs.appendFileSync(log, output) });
    const smoke = spawnSync(process.execPath, [path.join(root, 'scripts/plugin_smoke.js'), built.dllFile, casesFile], { cwd: root, windowsHide: true, encoding: 'utf8' });
    fs.appendFileSync(log, `${smoke.stdout || ''}\n${smoke.stderr || ''}`);
    if (smoke.error || smoke.status !== 0) throw new Error(`Plugin smoke failed: ${config.targetName}\n${smoke.stderr || smoke.error}`);
    summaries.push({ target: config.targetName, frameBytes: l.frameBytes, channels: l.channels.length, cases: definition.cases.length, dll: built.dllFile });
    console.log(`PASS ${config.targetName}: ${definition.cases.length} compiled-plugin cases`);
  }
  const legacy = JSON.parse(fs.readFileSync(path.join(root, 'examples/customfloat.vofa-engine.json')));
  console.log('Qt Release build: legacy CustomFloat');
  const built = await buildEngine(legacy, { repoRoot: repo, onOutput: (output) => fs.appendFileSync(log, output) });
  const smoke = spawnSync(process.execPath, [path.join(root, 'scripts/plugin_smoke.js'), built.dllFile], { cwd: root, windowsHide: true, encoding: 'utf8' });
  fs.appendFileSync(log, `${smoke.stdout || ''}\n${smoke.stderr || ''}`);
  if (smoke.error || smoke.status !== 0) throw new Error(`Legacy plugin smoke failed: ${smoke.stderr || smoke.error}`);
  summaries.push({ target: 'customfloat', legacy: true, dll: built.dllFile });
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify(summaries, null, 2));
  console.log(`PASS all ${summaries.length} Qt 5.14.2 MSVC2017 x64 Release plugins; results: ${workspace}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
