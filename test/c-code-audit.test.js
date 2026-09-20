'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { generateEngine } = require('../src/generator');

const fixtureRepositoryRoot = path.join(__dirname, 'fixtures', 'vofa-repository');

function createFixtureRepository(t) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vofa-c-audit-test-'));
  const resolvedTempRoot = path.resolve(temporaryRoot);
  t.after(() => fs.rmSync(resolvedTempRoot, { recursive: true, force: true }));

  const sourceDataEngines = path.join(fixtureRepositoryRoot, 'dataengines');
  const fixtureDataEngines = path.join(resolvedTempRoot, 'dataengines');
  fs.mkdirSync(path.join(fixtureDataEngines, 'generated', 'win64'), { recursive: true });
  fs.cpSync(path.join(sourceDataEngines, 'justfloat'), path.join(fixtureDataEngines, 'justfloat'), { recursive: true });
  fs.cpSync(path.join(sourceDataEngines, 'shared'), path.join(fixtureDataEngines, 'shared'), { recursive: true });
  fs.copyFileSync(
    path.join(sourceDataEngines, 'generated', 'justfloat.json'),
    path.join(fixtureDataEngines, 'generated', 'justfloat.json')
  );
  return resolvedTempRoot;
}

function baseConfig(engineName, wordCount, fields) {
  return {
    version: 2,
    engineName,
    wordCount,
    fields,
    descriptionAutoSync: true,
    descriptions: {
      SimplifiedChinese: { format: '测试', example: '测试', url: 'https://www.vofa.plus' },
      TraditionalChinese: { format: '測試', example: '測試', url: 'https://www.vofa.plus' },
      English: { format: 'Test', example: 'Test', url: 'https://www.vofa.plus' },
    }
  };
}

function readGeneratedCpp(repoRoot, targetName) {
  const engineDir = path.join(repoRoot, 'dataengines', targetName);
  const headerFile = path.join(engineDir, `${targetName}.h`);
  const sourceFile = path.join(engineDir, `${targetName}.cpp`);
  assert.ok(fs.existsSync(headerFile), `Header file ${headerFile} must exist`);
  assert.ok(fs.existsSync(sourceFile), `Source file ${sourceFile} must exist`);
  return {
    header: fs.readFileSync(headerFile, 'utf8'),
    source: fs.readFileSync(sourceFile, 'utf8'),
  };
}

test('C++ 代码生成审核: 变长短帧与 4 字节帧尾对齐协议保持不变', (t) => {
  const repoRoot = createFixtureRepository(t);
  const config = baseConfig('TailGuardEngine', 4, [
    { wordIndex: 0, type: 'float', bitOffset: 0, name: 'ch0' }
  ]);
  generateEngine(config, { repoRoot });
  const { header, source } = readGeneratedCpp(repoRoot, 'tailguardengine');

  // 1. 头文件保护宏与 Qt 插件契约
  assert.match(header, /#ifndef TAILGUARDENGINE_H/);
  assert.match(header, /#define TAILGUARDENGINE_H/);
  assert.match(header, /#endif \/\/ TAILGUARDENGINE_H/);
  assert.match(header, /class TailGuardEngine\s*:\s*public QObject,\s*public DataEngineInterface/);
  assert.match(header, /Q_PLUGIN_METADATA\s*\(\s*IID\s+"VOFA\+\.Plugin\.TailGuardEngine"\s*\)/);
  assert.match(header, /Q_INTERFACES\s*\(\s*DataEngineInterface\s*\)/);

  // 2. 帧尾检测与 4 字节对齐协议约束
  assert.match(source, /0x7F800000/);
  assert.match(source, /count\s*%\s*4\s*!=\s*0/);
  assert.match(source, /const\s+int\s+payloadBytes\s*=\s*count\s*-\s*4;/);
  assert.match(source, /for\s*\(\s*int\s+offset\s*=\s*0;\s*offset\s*<\s*payloadBytes;\s*offset\s*\+=\s*4\s*\)/);
});

test('C++ 代码生成审核: 方案 1 - 全 Float 默认配置与 memcpy 转换', (t) => {
  const repoRoot = createFixtureRepository(t);
  const config = baseConfig('AllFloatEngine', 4, [
    { wordIndex: 0, type: 'float', bitOffset: 0, name: 'ch0' },
    { wordIndex: 1, type: 'float', bitOffset: 0, name: 'ch1' }
  ]);
  generateEngine(config, { repoRoot });
  const { source } = readGeneratedCpp(repoRoot, 'allfloatengine');

  // 验证 float 字段使用 std::memcpy 转换
  assert.match(source, /case 0:\s*\{/);
  assert.match(source, /std::memcpy\(&value0,\s*&word,\s*sizeof\(value0\)\);/);
  assert.match(source, /dd\.append\(value0\);/);
  assert.match(source, /case 1:\s*\{/);
  assert.match(source, /std::memcpy\(&value1,\s*&word,\s*sizeof\(value1\)\);/);
  assert.match(source, /dd\.append\(value1\);/);

  // 未显式配置的 Word (Word 2, 3) 自动由 default 回退处理
  assert.doesNotMatch(source, /case 2:/);
  assert.doesNotMatch(source, /case 3:/);
  assert.match(source, /default:\s*\{/);
  assert.match(source, /std::memcpy\(&value,\s*data\s*\+\s*offset,\s*sizeof\(value\)\);/);
  assert.match(source, /dd\.append\(value\);/);
});

test('C++ 代码生成审核: 方案 2 - 单 Word 密集混合子字段 (bit, uint8, int8)', (t) => {
  const repoRoot = createFixtureRepository(t);
  const config = baseConfig('DenseMixedEngine', 2, [
    { wordIndex: 0, type: 'bit', bitOffset: 0, name: 'flag0' },
    { wordIndex: 0, type: 'uint8', bitOffset: 8, name: 'u8_state' },
    { wordIndex: 0, type: 'int8', bitOffset: 16, name: 'i8_temp' },
    { wordIndex: 0, type: 'bit', bitOffset: 24, name: 'flag24' },
  ]);
  generateEngine(config, { repoRoot });
  const { source } = readGeneratedCpp(repoRoot, 'densemixedengine');

  // 验证 case 0:
  assert.match(source, /case 0:\s*\{/);
  assert.match(source, /const quint32 word = static_cast<quint32>\(bytes\[offset\]\)/);

  // bit 0
  assert.match(source, /dd\.append\(static_cast<float>\(\(word >> 0\)\s*&\s*0x1u\)\);/);

  // uint8 (offset 8)
  assert.match(source, /dd\.append\(static_cast<float>\(\(word >> 8\)\s*&\s*0xffu\)\);/);

  // int8 补码符号扩展 (offset 16, 符号位 0x80u, 模数 0x100)
  assert.match(source, /const quint32 raw2 = \(word >> 16\) & 0xffu;/);
  assert.match(source, /\(raw2 & 0x80u\) != 0u/);
  assert.match(source, /static_cast<qint32>\(raw2\) - 0x100/);
  assert.match(source, /static_cast<qint32>\(raw2\);/);
  assert.match(source, /dd\.append\(static_cast<float>\(signedValue2\)\);/);

  // bit 24
  assert.match(source, /dd\.append\(static_cast<float>\(\(word >> 24\)\s*&\s*0x1u\)\);/);
});

test('C++ 代码生成审核: 方案 3 - 16-bit 有符号与无符号跨字节配置 (uint16, int16)', (t) => {
  const repoRoot = createFixtureRepository(t);
  const config = baseConfig('Word16Engine', 1, [
    { wordIndex: 0, type: 'uint16', bitOffset: 0, name: 'raw_adc' },
    { wordIndex: 0, type: 'int16', bitOffset: 16, name: 'signed_val' },
  ]);
  generateEngine(config, { repoRoot });
  const { source } = readGeneratedCpp(repoRoot, 'word16engine');

  // uint16 (offset 0)
  assert.match(source, /dd\.append\(static_cast<float>\(\(word >> 0\)\s*&\s*0xffffu\)\);/);

  // int16 补码符号扩展 (offset 16, 符号位 0x8000u, 模数 0x10000)
  assert.match(source, /const quint32 raw1 = \(word >> 16\) & 0xffffu;/);
  assert.match(source, /\(raw1 & 0x8000u\) != 0u/);
  assert.match(source, /static_cast<qint32>\(raw1\) - 0x10000/);
  assert.match(source, /dd\.append\(static_cast<float>\(signedValue1\)\);/);
});

test('C++ 代码生成审核: 方案 4 - 32-bit uint32 与 int32 整字配置及 64 位防溢出', (t) => {
  const repoRoot = createFixtureRepository(t);
  const config = baseConfig('Full32Engine', 2, [
    { wordIndex: 0, type: 'uint32', bitOffset: 0, name: 'counter_u32' },
    { wordIndex: 1, type: 'int32', bitOffset: 0, name: 'encoder_i32' },
  ]);
  generateEngine(config, { repoRoot });
  const { source } = readGeneratedCpp(repoRoot, 'full32engine');

  // Word 0: uint32 直接 cast float
  assert.match(source, /case 0:\s*\{/);
  assert.match(source, /dd\.append\(static_cast<float>\(word\)\);/);

  // Word 1: int32 使用 qint64 和 0x100000000LL 避免 32-bit 有符号溢出未定义行为
  assert.match(source, /case 1:\s*\{/);
  assert.match(source, /const qint64 signedValue1 = \(raw1 & 0x80000000u\) != 0u/);
  assert.match(source, /static_cast<qint64>\(raw1\) - 0x100000000LL/);
  assert.match(source, /static_cast<qint64>\(raw1\);/);
  assert.match(source, /dd\.append\(static_cast<float>\(signedValue1\)\);/);
});

test('C++ 代码生成审核: 方案 5 - 离散多 Word 间隙与动态追加通道配置', (t) => {
  const repoRoot = createFixtureRepository(t);
  const config = baseConfig('SparseEngine', 4, [
    { wordIndex: 0, type: 'uint8', bitOffset: 0, name: 'w0_b0' },
    // Word 1 是空白 Word，无自定义字段，应当回退
    { wordIndex: 2, type: 'uint16', bitOffset: 0, name: 'w2_u16_0' },
    { wordIndex: 2, type: 'uint16', bitOffset: 16, name: 'w2_u16_1' },
    // Word 3 是空白 Word
  ]);
  generateEngine(config, { repoRoot });
  const { source } = readGeneratedCpp(repoRoot, 'sparseengine');

  // case 0 与 case 2 存在
  assert.match(source, /case 0:\s*\{/);
  assert.match(source, /case 2:\s*\{/);

  // case 1 与 case 3 不出现，自动走 default fallback
  assert.doesNotMatch(source, /case 1:/);
  assert.doesNotMatch(source, /case 3:/);

  // 验证 default 分支保持 JustFloat 语义
  assert.match(source, /default:\s*\{/);
  assert.match(source, /std::memcpy\(&value, data \+ offset, sizeof\(value\)\);/);
  assert.match(source, /dd\.append\(value\);/);
});
