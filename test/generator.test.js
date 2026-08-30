'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildEngine,
  createBuildOutputDecoder,
  decodeBuildOutputBuffer,
  deriveEngineNames,
  generateEngine,
  getEnvironment,
  normalizeConfig,
  validateConfig,
} = require('../src/generator');

const fixtureRepositoryRoot = path.join(__dirname, 'fixtures', 'vofa-repository');
const sampleConfig = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'customfloat.vofa-engine.json'),
  'utf8',
));

function configFor(engineName) {
  return {
    ...sampleConfig,
    engineName,
    descriptions: JSON.parse(JSON.stringify(sampleConfig.descriptions)),
    fields: sampleConfig.fields.map((field) => ({ ...field })),
  };
}

function createFixtureRepository(t) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vofa-engine-builder-test-'));
  const resolvedTempRoot = path.resolve(temporaryRoot);
  const resolvedOsTemp = path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolvedTempRoot), resolvedOsTemp);
  assert.match(path.basename(resolvedTempRoot), /^vofa-engine-builder-test-/);
  t.after(() => fs.rmSync(resolvedTempRoot, { recursive: true, force: true }));

  const sourceDataEngines = path.join(fixtureRepositoryRoot, 'dataengines');
  const fixtureDataEngines = path.join(resolvedTempRoot, 'dataengines');
  fs.mkdirSync(path.join(fixtureDataEngines, 'generated', 'win64'), { recursive: true });
  fs.cpSync(
    path.join(sourceDataEngines, 'justfloat'),
    path.join(fixtureDataEngines, 'justfloat'),
    { recursive: true },
  );
  fs.cpSync(
    path.join(sourceDataEngines, 'shared'),
    path.join(fixtureDataEngines, 'shared'),
    { recursive: true },
  );
  fs.copyFileSync(
    path.join(sourceDataEngines, 'generated', 'justfloat.json'),
    path.join(fixtureDataEngines, 'generated', 'justfloat.json'),
  );
  return resolvedTempRoot;
}

test('derives display, target, and C++ class names from one engine name', () => {
  assert.deepEqual(deriveEngineNames('  Telemetry 32-Bit  '), {
    engineName: 'Telemetry 32-Bit',
    displayName: 'Telemetry 32-Bit',
    targetName: 'telemetry32bit',
    className: 'Telemetry32Bit',
  });
  assert.equal(deriveEngineNames('CustomFloat').className, 'CustomFloat');
  assert.equal(deriveEngineNames('CustomFloat').targetName, 'customfloat');
});

test('normalizes schema v2 without mutating input or description text', () => {
  const input = configFor('  Custom Float  ');
  input.descriptionAutoSync = true;
  input.fields = [{ wordIndex: 0, type: ' UINT8 ', bitOffset: 0, name: ' state ' }];
  input.descriptions.English.format = '  keep whitespace exactly  ';
  const normalized = normalizeConfig(input);

  assert.equal(normalized.version, 2);
  assert.equal(normalized.engineName, 'Custom Float');
  assert.equal(normalized.targetName, 'customfloat');
  assert.equal(normalized.className, 'CustomFloat');
  assert.equal(normalized.descriptionAutoSync, true);
  assert.equal(normalized.fields[0].type, 'uint8');
  assert.equal(normalized.fields[0].name, 'state');
  assert.equal(normalized.descriptions.English.format, '  keep whitespace exactly  ');
  assert.equal(input.fields[0].type, ' UINT8 ');
});

test('decodes UTF-8 and fragmented Windows GB18030 build output without mojibake', () => {
  assert.equal(
    decodeBuildOutputBuffer(Buffer.from('Release 构建完成。', 'utf8')),
    'Release 构建完成。',
  );

  const chineseLinkerLine = Buffer.concat([
    Buffer.from('D5FDD4DAB4B4BDA8BFE2', 'hex'),
    Buffer.from(' .\\mlw.lib\r\n', 'ascii'),
  ]);
  const decoded = [];
  const decoder = createBuildOutputDecoder((text) => decoded.push(text));
  decoder.push(chineseLinkerLine.subarray(0, 3));
  decoder.push(chineseLinkerLine.subarray(3, 9));
  decoder.push(chineseLinkerLine.subarray(9));
  decoder.end();

  assert.equal(decoded.join(''), '正在创建库 .\\mlw.lib\r\n');
});

test('migrates a v1 configuration to schema v2 and supplies descriptions', () => {
  const legacy = {
    version: 1,
    targetName: 'legacyfloat',
    className: 'LegacyFloat',
    displayName: 'Legacy Float',
    wordCount: 1,
    fields: [{ wordIndex: 0, type: 'float', bitOffset: 0, name: 'value' }],
  };
  const migrated = normalizeConfig(legacy);

  assert.equal(migrated.version, 2);
  assert.equal(migrated.engineName, 'Legacy Float');
  assert.equal(migrated.targetName, 'legacyfloat');
  assert.equal(migrated.className, 'LegacyFloat');
  assert.match(migrated.descriptions.SimplifiedChinese.format, /Legacy Float/);
  assert.equal(typeof migrated.descriptions.TraditionalChinese.example, 'string');
  assert.match(migrated.descriptions.English.url, /^https:\/\//);
  assert.match(migrated.descriptions.English.format, /later Words retain JustFloat behavior/);
});

test('rejects derived built-in names, overlaps, unaligned fields, and invalid descriptions', () => {
  const config = {
    version: 2,
    engineName: 'Just Float',
    wordCount: 1,
    descriptions: {
      SimplifiedChinese: { format: 42, example: '', url: '' },
      TraditionalChinese: { format: '', example: '', url: '' },
      English: { format: '', example: '', url: '' },
    },
    fields: [
      { wordIndex: 0, type: 'uint16', bitOffset: 0, name: 'first' },
      { wordIndex: 0, type: 'uint8', bitOffset: 8, name: 'overlap' },
      { wordIndex: 0, type: 'uint16', bitOffset: 1, name: 'unaligned' },
      { wordIndex: 0, type: 'uint8', bitOffset: 32, name: 'outside' },
    ],
  };
  const validation = validateConfig(config);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((message) => message.includes('built-in data engine')));
  assert.ok(validation.errors.some((message) => message.includes('overlaps')));
  assert.ok(validation.errors.some((message) => message.includes('byte boundary')));
  assert.ok(validation.errors.some((message) => message.includes('exceeds')));
  assert.ok(validation.errors.some((message) => message.includes('SimplifiedChinese.format')));
});

test('generates beside justfloat, preserves sibling shared paths, and emits exact descriptions', (t) => {
  const fixtureRoot = createFixtureRepository(t);
  const result = generateEngine(sampleConfig, { repoRoot: fixtureRoot });

  assert.equal(result.success, true);
  assert.equal(result.sourceDirectory, path.join(fixtureRoot, 'dataengines', 'customfloat'));
  assert.equal(path.basename(result.projectFile), 'customfloat.pro');
  assert.equal(path.basename(result.descriptionFile), 'customfloat.json');
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'dataengines', 'generated', 'sources')), false);

  const header = fs.readFileSync(result.headerFile, 'utf8');
  const source = fs.readFileSync(result.sourceFile, 'utf8');
  const project = fs.readFileSync(result.projectFile, 'utf8');
  const description = JSON.parse(fs.readFileSync(result.descriptionFile, 'utf8'));
  const marker = JSON.parse(fs.readFileSync(result.configFile, 'utf8'));

  assert.match(header, /class CustomFloat/);
  assert.match(header, /Q_PLUGIN_METADATA\(IID "VOFA\+\.Plugin\.CustomFloat"\)/);
  assert.doesNotMatch(header, /\bclass JustFloat\b/);
  assert.match(source, /data == nullptr \|\| count <= 0 \|\| count % 4 != 0/);
  assert.match(source, /for \(int offset = 0; offset < payloadBytes; offset \+= 4\)/);
  assert.match(source, /case 0:/);
  assert.match(source, /word >> 16/);
  assert.match(source, /word >> 31/);
  assert.match(source, /default:[\s\S]*std::memcpy\(&value, data \+ offset/);
  assert.doesNotMatch(source, /count != expectedCount/);
  assert.doesNotMatch(source, /minimumCount/);
  assert.match(source, /CustomFloat::ProcessingDatas/);
  assert.match(source, /这是个图片前导帧/);
  assert.doesNotMatch(source, /JustFloat::/);
  assert.match(project, /^TARGET = customfloat$/m);
  assert.match(project, /\.\.\/shared\//);
  assert.doesNotMatch(project, /\.\.\/\.\.\/\.\.\/shared\//);
  assert.deepEqual(description.SimplifiedChinese, sampleConfig.descriptions.SimplifiedChinese);
  assert.deepEqual(description.TraditionalChinese, sampleConfig.descriptions.TraditionalChinese);
  assert.deepEqual(description.English, sampleConfig.descriptions.English);
  assert.equal(marker.generator, 'vofa-justfloat-engine-builder');
  assert.equal(marker.version, 2);
  assert.equal(marker.targetName, 'customfloat');
});

test('rebuilds only a directory carrying the matching generator config marker', (t) => {
  const fixtureRoot = createFixtureRepository(t);
  const first = generateEngine(sampleConfig, { repoRoot: fixtureRoot });
  const obsoleteFile = path.join(first.sourceDirectory, 'obsolete.tmp');
  fs.writeFileSync(obsoleteFile, 'old', 'utf8');

  const second = generateEngine(sampleConfig, { repoRoot: fixtureRoot });
  assert.equal(second.sourceDirectory, first.sourceDirectory);
  assert.equal(fs.existsSync(obsoleteFile), false);
  assert.equal(fs.existsSync(second.configFile), true);
});

test('restores the prior generated source when the staging-directory swap fails', (t) => {
  const fixtureRoot = createFixtureRepository(t);
  const config = configFor('Rollback Engine');
  const first = generateEngine(config, { repoRoot: fixtureRoot });
  const priorSource = fs.readFileSync(first.sourceFile);
  const priorMarker = fs.readFileSync(first.configFile);
  const changed = configFor('Rollback Engine');
  changed.wordCount = 2;

  const originalRenameSync = fs.renameSync;
  fs.renameSync = (source, destination) => {
    const sourceName = path.basename(source);
    if (sourceName.startsWith('.rollbackengine.vofa-builder-')
        && path.resolve(destination) === path.resolve(first.sourceDirectory)) {
      const error = new Error('simulated staging swap failure');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync(source, destination);
  };
  try {
    assert.throws(
      () => generateEngine(changed, { repoRoot: fixtureRoot }),
      (error) => error.code === 'SOURCE_COMMIT_FAILED',
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.deepEqual(fs.readFileSync(first.sourceFile), priorSource);
  assert.deepEqual(fs.readFileSync(first.configFile), priorMarker);
});

test('never replaces an ordinary same-name engine directory', (t) => {
  const fixtureRoot = createFixtureRepository(t);
  const ordinaryDirectory = path.join(fixtureRoot, 'dataengines', 'guardedengine');
  const ordinaryFile = path.join(ordinaryDirectory, 'keep.txt');
  fs.mkdirSync(ordinaryDirectory);
  fs.writeFileSync(ordinaryFile, 'user data', 'utf8');

  assert.throws(
    () => generateEngine(configFor('Guarded Engine'), { repoRoot: fixtureRoot }),
    (error) => error.code === 'UNSAFE_GENERATED_DIRECTORY',
  );
  assert.equal(fs.readFileSync(ordinaryFile, 'utf8'), 'user data');
});

test('requires explicit adoption before replacing legacy DLL or JSON artifacts', (t) => {
  const fixtureRoot = createFixtureRepository(t);
  const config = configFor('Legacy Output');
  const legacyJson = path.join(fixtureRoot, 'dataengines', 'generated', 'legacyoutput.json');
  fs.writeFileSync(legacyJson, '{"legacy":true}\n', 'utf8');

  assert.throws(
    () => generateEngine(config, { repoRoot: fixtureRoot }),
    (error) => error.code === 'OUTPUT_EXISTS' && error.details.requiresConfirmation === true,
  );
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'dataengines', 'legacyoutput')), false);

  const adopted = generateEngine(config, {
    repoRoot: fixtureRoot,
    allowExistingArtifacts: true,
  });
  assert.equal(fs.existsSync(adopted.configFile), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(adopted.descriptionFile, 'utf8')).English,
    sampleConfig.descriptions.English,
  );
});

test('rejects a directory that does not contain the complete repository templates', (t) => {
  const fixtureRoot = createFixtureRepository(t);
  fs.rmSync(path.join(fixtureRoot, 'dataengines', 'shared'), { recursive: true, force: true });

  assert.throws(
    () => generateEngine(sampleConfig, { repoRoot: fixtureRoot }),
    (error) => error.code === 'INVALID_REPOSITORY'
      && error.details.missing.includes('dataengines/shared'),
  );
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'dataengines', 'customfloat')), false);
});

test('reports a missing repository without preventing toolchain scanning', () => {
  const environment = getEnvironment(null);
  assert.equal(environment.repositoryReady, false);
  assert.equal(environment.ready, false);
  assert.ok(environment.missing.includes('valid VOFA+ repository root'));
  assert.ok(Array.isArray(environment.warnings));
});

test('validates manually selected tool paths during an environment refresh', (t) => {
  const fixtureRoot = createFixtureRepository(t);
  const environment = getEnvironment({
    repoRoot: fixtureRoot,
    qmakePath: path.join(fixtureRoot, 'missing-qmake.exe'),
  });
  assert.equal(environment.repositoryReady, true);
  assert.equal(environment.ready, false);
  assert.equal(environment.qmakePath, null);
  assert.ok(environment.missing.includes('qmake.exe'));
});

test('an incomplete build environment fails before writing source or JSON', async (t) => {
  const fixtureRoot = createFixtureRepository(t);
  const config = configFor('No Write');
  await assert.rejects(
    buildEngine(config, {
      repoRoot: fixtureRoot,
      qmakePath: path.join(fixtureRoot, 'definitely-missing-qmake.exe'),
    }),
    (error) => error.code === 'ENVIRONMENT_NOT_READY'
      && error.message.includes('Desktop_Qt_5_14_2_MSVC2017_64bit-Release'),
  );
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'dataengines', 'nowrite')), false);
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'dataengines', 'generated', 'nowrite.json')), false);
});

test('a compiler failure preserves the prior runtime DLL and JSON byte-for-byte', async (t) => {
  const fixtureRoot = createFixtureRepository(t);
  if (!getEnvironment(fixtureRoot).ready) {
    t.skip('The exact Windows Qt/MSVC toolchain is unavailable on this host.');
    return;
  }

  const initial = generateEngine(sampleConfig, { repoRoot: fixtureRoot });
  const dllFile = path.join(fixtureRoot, 'dataengines', 'generated', 'win64', 'customfloat.dll');
  const priorJson = Buffer.from('{"runtime":"prior-json"}\r\n', 'utf8');
  const priorDll = Buffer.from([0x4d, 0x5a, 0x10, 0x20, 0x30, 0x40]);
  fs.writeFileSync(initial.descriptionFile, priorJson);
  fs.writeFileSync(dllFile, priorDll);

  const changed = configFor('Custom Float');
  changed.descriptions.English.format = 'This descriptor must not commit after a failed build.';
  let runnerCalled = false;
  await assert.rejects(
    buildEngine(changed, {
      repoRoot: fixtureRoot,
      commandRunner: async () => {
        runnerCalled = true;
        const error = new Error('simulated compiler failure');
        error.code = 'SIMULATED_BUILD_FAILURE';
        throw error;
      },
    }),
    (error) => error.code === 'SIMULATED_BUILD_FAILURE',
  );

  assert.equal(runnerCalled, true);
  assert.deepEqual(fs.readFileSync(initial.descriptionFile), priorJson);
  assert.deepEqual(fs.readFileSync(dllFile), priorDll);
});

test('a pair-commit failure rolls both runtime artifacts back', async (t) => {
  const fixtureRoot = createFixtureRepository(t);
  if (!getEnvironment(fixtureRoot).ready) {
    t.skip('The exact Windows Qt/MSVC toolchain is unavailable on this host.');
    return;
  }

  const initial = generateEngine(sampleConfig, { repoRoot: fixtureRoot });
  const dllFile = path.join(fixtureRoot, 'dataengines', 'generated', 'win64', 'customfloat.dll');
  const priorJson = Buffer.from('{"runtime":"rollback-json"}\r\n', 'utf8');
  const priorDll = Buffer.from([0x4d, 0x5a, 0xaa, 0xbb, 0xcc]);
  fs.writeFileSync(initial.descriptionFile, priorJson);
  fs.writeFileSync(dllFile, priorDll);

  const changed = configFor('Custom Float');
  changed.descriptions.English.format = 'A new descriptor that must roll back with the DLL.';
  const originalRenameSync = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (path.basename(source).startsWith('.customfloat.dll.vofa-staged-')
        && path.resolve(destination) === path.resolve(dllFile)) {
      const error = new Error('simulated DLL commit failure');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync(source, destination);
  };
  try {
    await assert.rejects(
      buildEngine(changed, {
        repoRoot: fixtureRoot,
        commandRunner: async (_environment, _projectFile, buildDirectory) => {
          fs.writeFileSync(path.join(buildDirectory, 'customfloat.dll'), Buffer.from('new dll'));
          return { command: 'simulated', exitCode: 0, output: 'simulated build success' };
        },
      }),
      (error) => error.code === 'ARTIFACT_COMMIT_FAILED',
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.deepEqual(fs.readFileSync(initial.descriptionFile), priorJson);
  assert.deepEqual(fs.readFileSync(dllFile), priorDll);
});
