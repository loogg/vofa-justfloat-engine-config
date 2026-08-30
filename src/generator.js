'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const CONFIG_VERSION = 2;
const WORD_SIZE = 4;
const FRAME_TAIL_SIZE = 4;
const REQUESTED_QT_VERSION = '5.14.2';
const REQUESTED_QT_KIT = 'Desktop_Qt_5_14_2_MSVC2017_64bit-Release';
const GENERATOR_ID = 'vofa-justfloat-engine-builder';
const GENERATOR_MARKER_FILE = '.vofa-engine-builder.json';
const BUILD_MARKER_FILE = '.vofa-engine-builder-build.json';
const DESCRIPTION_LANGUAGES = Object.freeze([
  'SimplifiedChinese',
  'TraditionalChinese',
  'English',
]);
const FIELD_WIDTHS = Object.freeze({
  bit: 1,
  uint8: 8,
  uint16: 16,
  uint32: 32,
  float: 32,
});

const CPP_KEYWORDS = new Set([
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand',
  'bitor', 'bool', 'break', 'case', 'catch', 'char', 'char16_t',
  'char32_t', 'class', 'compl', 'concept', 'const', 'constexpr',
  'const_cast', 'continue', 'co_await', 'co_return', 'co_yield',
  'decltype', 'default', 'delete', 'do', 'double', 'dynamic_cast',
  'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float',
  'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable',
  'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr',
  'operator', 'or', 'or_eq', 'private', 'protected', 'public',
  'register', 'reinterpret_cast', 'requires', 'return', 'short',
  'signed', 'sizeof', 'static', 'static_assert', 'static_cast',
  'struct', 'switch', 'template', 'this', 'thread_local', 'throw',
  'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned',
  'using', 'virtual', 'void', 'volatile', 'wchar_t', 'while', 'xor',
  'xor_eq',
  // Qt turns these identifiers into tokens before the C++ compiler sees them.
  'emit', 'foreach', 'forever', 'signals', 'slots', 'Q_OBJECT',
  'Q_GADGET', 'Q_PROPERTY',
]);

const COLLIDING_CLASS_NAMES = new Set([
  'QObject', 'DataEngineInterface', 'RawImage', 'Frame',
]);

const BUILTIN_TARGETS = new Set([
  'firewater', 'indexfloat', 'justfloat', 'rawdata',
]);

const BUILTIN_CLASSES = new Set([
  'FireWater', 'IndexFloat', 'JustFloat', 'RawData',
]);

function createError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function engineNameWords(engineName) {
  if (typeof engineName !== 'string') return [];
  return engineName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * Derive every build identifier from the single name shown to the user.
 * Keeping this policy in one exported function prevents the renderer, qmake
 * project and plugin metadata from drifting apart.
 */
function deriveEngineNames(engineName) {
  const displayName = trimmedString(engineName);
  const words = engineNameWords(displayName);
  const targetName = words.join('').toLowerCase();
  const className = words.map((word) => (
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  )).join('');
  return {
    engineName: displayName,
    displayName,
    targetName,
    className,
  };
}

function migrateV1EngineName(config) {
  const legacyTarget = trimmedString(config.targetName);
  const legacyClass = trimmedString(config.className);
  const candidates = [config.displayName, config.className, config.targetName]
    .map(trimmedString)
    .filter((value, index, values) => (
      typeof value === 'string' && value.length > 0 && values.indexOf(value) === index
    ));

  return candidates.find((candidate) => {
    const derived = deriveEngineNames(candidate);
    return derived.targetName === legacyTarget && derived.className === legacyClass;
  }) || candidates.find((candidate) => deriveEngineNames(candidate).className === legacyClass)
    || candidates.find((candidate) => deriveEngineNames(candidate).targetName === legacyTarget)
    || candidates[0];
}

function defaultDescriptions(config) {
  const payloadBytes = Number.isInteger(config.wordCount)
    ? config.wordCount * WORD_SIZE
    : 0;
  const layout = Array.isArray(config.fields) ? descriptionLayout(config) : '';
  const example = Number.isInteger(config.wordCount) && config.wordCount > 0
    ? descriptorExample(config)
    : '';
  const url = 'https://www.vofa.plus/docs/learning/dataengines/introduce';
  return {
    SimplifiedChinese: {
      format: `${config.displayName} 使用固定长度小端帧：${config.wordCount} 个 4 字节数据字（${payloadBytes} 字节），随后是帧尾 00 00 80 7F。\n通道按 word/bit 位置排序输出，bit 和无符号整数转换为 float 通道值。${layout ? `\n${layout}` : ''}`,
      example,
      url,
    },
    TraditionalChinese: {
      format: `${config.displayName} 使用固定長度小端幀：${config.wordCount} 個 4 位元組資料字（${payloadBytes} 位元組），隨後是幀尾 00 00 80 7F。\n通道按 word/bit 位置排序輸出，bit 和無符號整數轉換為 float 通道值。${layout ? `\n${layout}` : ''}`,
      example,
      url,
    },
    English: {
      format: `${config.displayName} uses a fixed-length little-endian frame: ${config.wordCount} four-byte words (${payloadBytes} bytes), followed by 00 00 80 7F.\nChannels are emitted in word/bit order; bits and unsigned integers are converted to float channel values.${layout ? `\n${layout}` : ''}`,
      example,
      url,
    },
  };
}

/**
 * Return a detached, canonical representation without mutating caller data.
 * Structural and semantic errors are deliberately left for validateConfig.
 */
function normalizeConfig(config) {
  if (!isPlainObject(config)) {
    throw createError('INVALID_CONFIG', 'Configuration must be a JSON object.');
  }

  const inputVersion = config.version === undefined
    ? (config.engineName === undefined ? 1 : CONFIG_VERSION)
    : config.version;
  const engineName = inputVersion === 1
    ? migrateV1EngineName(config)
    : trimmedString(config.engineName);
  const names = deriveEngineNames(engineName);
  const fields = Array.isArray(config.fields)
    ? config.fields.map((field) => {
      if (!isPlainObject(field)) {
        return field;
      }
      return {
        wordIndex: field.wordIndex,
        type: typeof field.type === 'string'
          ? field.type.trim().toLowerCase()
          : field.type,
        bitOffset: field.bitOffset,
        name: field.name === undefined ? '' : trimmedString(field.name),
      };
    })
    : config.fields;

  const base = {
    version: inputVersion === 1 ? CONFIG_VERSION : inputVersion,
    ...names,
    wordCount: config.wordCount,
    fields,
    descriptionAutoSync: config.descriptionAutoSync === true,
  };
  const defaults = defaultDescriptions(base);
  const sourceDescriptions = isPlainObject(config.descriptions)
    ? config.descriptions
    : {};
  base.descriptions = {};
  DESCRIPTION_LANGUAGES.forEach((language) => {
    const source = isPlainObject(sourceDescriptions[language])
      ? sourceDescriptions[language]
      : {};
    base.descriptions[language] = {
      format: source.format === undefined ? defaults[language].format : source.format,
      example: source.example === undefined ? defaults[language].example : source.example,
      url: source.url === undefined ? defaults[language].url : source.url,
    };
  });
  return base;
}

function validateConfig(config) {
  let normalized;
  const errors = [];

  try {
    normalized = normalizeConfig(config);
  } catch (error) {
    return {
      valid: false,
      errors: [error.message],
      config: null,
    };
  }

  if (!Number.isInteger(normalized.version)
      || normalized.version !== CONFIG_VERSION) {
    errors.push(`version must be ${CONFIG_VERSION}.`);
  }

  if (config.descriptionAutoSync !== undefined
      && typeof config.descriptionAutoSync !== 'boolean') {
    errors.push('descriptionAutoSync must be a boolean when provided.');
  }

  if (config.descriptions !== undefined && !isPlainObject(config.descriptions)) {
    errors.push('descriptions must be an object when provided.');
  } else if (isPlainObject(config.descriptions)) {
    DESCRIPTION_LANGUAGES.forEach((language) => {
      if (config.descriptions[language] !== undefined
          && !isPlainObject(config.descriptions[language])) {
        errors.push(`descriptions.${language} must be an object.`);
      }
    });
  }

  if (typeof normalized.engineName !== 'string' || normalized.engineName.length === 0) {
    errors.push('engineName is required.');
  } else if (!/^[A-Za-z][A-Za-z0-9 _-]*$/.test(normalized.engineName)) {
    errors.push('engineName must start with an ASCII letter and contain only letters, numbers, spaces, hyphens, or underscores.');
  }

  if (typeof normalized.targetName !== 'string'
      || !/^[a-z][a-z0-9_]*$/.test(normalized.targetName)) {
    errors.push('targetName must be a lowercase file stem that starts with a letter and contains only a-z, 0-9, and underscore.');
  } else {
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized.targetName)) {
      errors.push(`targetName "${normalized.targetName}" is reserved by Windows.`);
    }
    if (BUILTIN_TARGETS.has(normalized.targetName)) {
      errors.push(`targetName "${normalized.targetName}" belongs to a built-in data engine; choose a custom name.`);
    }
  }

  if (typeof normalized.className !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized.className)) {
    errors.push('className must be a standalone C++ identifier.');
  } else {
    if (CPP_KEYWORDS.has(normalized.className)) {
      errors.push(`className "${normalized.className}" is a C++/Qt keyword.`);
    }
    if (COLLIDING_CLASS_NAMES.has(normalized.className)) {
      errors.push(`className "${normalized.className}" conflicts with a type required by the data-engine interface.`);
    }
    if (BUILTIN_CLASSES.has(normalized.className)) {
      errors.push(`className "${normalized.className}" belongs to a built-in data engine; choose a custom class name.`);
    }
  }

  DESCRIPTION_LANGUAGES.forEach((language) => {
    const description = normalized.descriptions && normalized.descriptions[language];
    if (!isPlainObject(description)) {
      errors.push(`descriptions.${language} must be an object.`);
      return;
    }
    ['format', 'example', 'url'].forEach((property) => {
      if (typeof description[property] !== 'string') {
        errors.push(`descriptions.${language}.${property} must be a string.`);
      }
    });
  });

  if (!Number.isInteger(normalized.wordCount)
      || normalized.wordCount < 1
      || normalized.wordCount > 256) {
    errors.push('wordCount must be an integer between 1 and 256.');
  }

  if (!Array.isArray(normalized.fields) || normalized.fields.length === 0) {
    errors.push('fields must contain at least one channel field.');
  } else {
    const canCheckWords = Number.isInteger(normalized.wordCount)
      && normalized.wordCount >= 1
      && normalized.wordCount <= 256;
    const occupiedBits = canCheckWords
      ? Array.from({ length: normalized.wordCount }, () => Array(32).fill(-1))
      : [];

    normalized.fields.forEach((field, fieldIndex) => {
      const prefix = `fields[${fieldIndex}]`;
      if (!isPlainObject(field)) {
        errors.push(`${prefix} must be an object.`);
        return;
      }

      if (!Number.isInteger(field.wordIndex)) {
        errors.push(`${prefix}.wordIndex must be an integer.`);
      } else if (canCheckWords
          && (field.wordIndex < 0 || field.wordIndex >= normalized.wordCount)) {
        errors.push(`${prefix}.wordIndex is outside wordCount.`);
      }

      const width = typeof field.type === 'string'
        ? FIELD_WIDTHS[field.type]
        : undefined;
      if (!width) {
        errors.push(`${prefix}.type must be one of bit, uint8, uint16, uint32, or float.`);
      }

      if (!Number.isInteger(field.bitOffset)) {
        errors.push(`${prefix}.bitOffset must be an integer.`);
      } else if (width) {
        if (field.bitOffset < 0 || field.bitOffset + width > 32) {
          errors.push(`${prefix} exceeds its four-byte word.`);
        }
        if (field.type !== 'bit' && field.bitOffset % 8 !== 0) {
          errors.push(`${prefix} must start on a byte boundary.`);
        }
      }

      if (typeof field.name !== 'string') {
        errors.push(`${prefix}.name must be a string when provided.`);
      }

      const canCheckOverlap = canCheckWords
        && Number.isInteger(field.wordIndex)
        && field.wordIndex >= 0
        && field.wordIndex < normalized.wordCount
        && Number.isInteger(field.bitOffset)
        && width
        && field.bitOffset >= 0
        && field.bitOffset + width <= 32;

      if (canCheckOverlap) {
        let overlapWith = -1;
        for (let bit = field.bitOffset; bit < field.bitOffset + width; bit += 1) {
          if (occupiedBits[field.wordIndex][bit] !== -1) {
            overlapWith = occupiedBits[field.wordIndex][bit];
            break;
          }
        }
        if (overlapWith !== -1) {
          errors.push(`${prefix} overlaps fields[${overlapWith}] in word ${field.wordIndex}.`);
        } else {
          for (let bit = field.bitOffset; bit < field.bitOffset + width; bit += 1) {
            occupiedBits[field.wordIndex][bit] = fieldIndex;
          }
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    config: normalized,
  };
}

function requireValidConfig(config) {
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw createError(
      'INVALID_CONFIG',
      `Invalid data-engine configuration:\n- ${validation.errors.join('\n- ')}`,
      validation.errors,
    );
  }
  return validation.config;
}

function resolveRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '' || repoRoot.includes('\0')) {
    throw createError(
      'REPOSITORY_REQUIRED',
      'Select the VOFA+ repository root before generating or building an engine.',
    );
  }
  return path.resolve(repoRoot.trim());
}

function inspectRepositoryLayout(repoRoot) {
  let resolvedRoot = null;
  const missing = [];
  try {
    resolvedRoot = resolveRepoRoot(repoRoot);
  } catch (error) {
    return {
      valid: false,
      repoRoot: null,
      dataEnginesDirectory: null,
      missing: ['VOFA+ repository root'],
      message: error.message,
    };
  }

  const dataEnginesDirectory = path.join(resolvedRoot, 'dataengines');
  const requiredDirectories = [
    ['dataengines/justfloat', path.join(dataEnginesDirectory, 'justfloat')],
    ['dataengines/shared', path.join(dataEnginesDirectory, 'shared')],
    ['dataengines/generated', path.join(dataEnginesDirectory, 'generated')],
  ];
  requiredDirectories.forEach(([label, directory]) => {
    try {
      if (!fs.statSync(directory).isDirectory()) missing.push(label);
    } catch (_) {
      missing.push(label);
    }
  });

  const requiredFiles = [
    ['dataengines/justfloat/justfloat.h', path.join(dataEnginesDirectory, 'justfloat', 'justfloat.h')],
    ['dataengines/justfloat/justfloat.cpp', path.join(dataEnginesDirectory, 'justfloat', 'justfloat.cpp')],
    ['dataengines/justfloat/justfloat.pro', path.join(dataEnginesDirectory, 'justfloat', 'justfloat.pro')],
    ['dataengines/shared/dataengineinterface.h', path.join(dataEnginesDirectory, 'shared', 'dataengineinterface.h')],
    ['dataengines/generated/justfloat.json', path.join(dataEnginesDirectory, 'generated', 'justfloat.json')],
  ];
  requiredFiles.forEach(([label, filePath]) => {
    try {
      if (!fs.statSync(filePath).isFile()) missing.push(label);
    } catch (_) {
      missing.push(label);
    }
  });

  return {
    valid: missing.length === 0,
    repoRoot: resolvedRoot,
    dataEnginesDirectory,
    missing,
    message: missing.length === 0
      ? ''
      : `The selected directory is not a VOFA+ repository; missing: ${missing.join(', ')}`,
  };
}

function requireRepositoryLayout(repoRoot) {
  const layout = inspectRepositoryLayout(repoRoot);
  if (!layout.valid) {
    throw createError('INVALID_REPOSITORY', layout.message, layout);
  }
  return layout;
}

function assertFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    throw createError(
      'MISSING_TEMPLATE',
      `${label} does not exist: ${filePath}`,
      { filePath, cause: error.message },
    );
  }
  if (!stat.isFile()) {
    throw createError('MISSING_TEMPLATE', `${label} is not a file: ${filePath}`);
  }
}

function samePath(left, right) {
  const normalize = process.platform === 'win32'
    ? (value) => path.resolve(value).toLowerCase()
    : (value) => path.resolve(value);
  return normalize(left) === normalize(right);
}

function assertExactDisposableDirectory(candidate, expected, expectedParent, label) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedExpected = path.resolve(expected);
  const resolvedParent = path.resolve(expectedParent);

  if (!samePath(resolvedCandidate, resolvedExpected)
      || !samePath(path.dirname(resolvedCandidate), resolvedParent)) {
    throw createError(
      'UNSAFE_DELETE',
      `Refusing to delete unexpected ${label}: ${resolvedCandidate}`,
      { expected: resolvedExpected },
    );
  }

  if (fs.existsSync(resolvedCandidate)) {
    const stat = fs.lstatSync(resolvedCandidate);
    if (stat.isSymbolicLink()) {
      throw createError(
        'UNSAFE_DELETE',
        `Refusing to recursively delete a symbolic link used as ${label}: ${resolvedCandidate}`,
      );
    }
  }
}

function readGeneratorMarker(directory, expectedTarget) {
  const markerFile = path.join(directory, GENERATOR_MARKER_FILE);
  assertFile(markerFile, 'generator config marker');
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  } catch (error) {
    throw createError(
      'UNSAFE_GENERATED_DIRECTORY',
      `Refusing to replace ${directory}: its generator config marker is invalid.`,
      { markerFile, cause: error.message },
    );
  }
  if (!isPlainObject(marker)
      || marker.generator !== GENERATOR_ID
      || marker.targetName !== expectedTarget
      || marker.version !== CONFIG_VERSION) {
    throw createError(
      'UNSAFE_GENERATED_DIRECTORY',
      `Refusing to replace ${directory}: it is not owned by this generator.`,
      { markerFile },
    );
  }
  return marker;
}

function assertReplaceableEngineDirectory(sourceDirectory, dataEnginesDirectory, targetName) {
  assertExactDisposableDirectory(
    sourceDirectory,
    path.join(dataEnginesDirectory, targetName),
    dataEnginesDirectory,
    'generated engine source directory',
  );
  if (!fs.existsSync(sourceDirectory)) return false;
  const stat = fs.lstatSync(sourceDirectory);
  if (!stat.isDirectory()) {
    throw createError(
      'UNSAFE_GENERATED_DIRECTORY',
      `Refusing to replace a non-directory engine path: ${sourceDirectory}`,
    );
  }
  try {
    readGeneratorMarker(sourceDirectory, targetName);
  } catch (error) {
    if (error.code === 'MISSING_TEMPLATE') {
      throw createError(
        'UNSAFE_GENERATED_DIRECTORY',
        `Refusing to replace ${sourceDirectory}: the generator config marker is missing.`,
      );
    }
    throw error;
  }
  return true;
}

function resetOwnedBuildDirectory(buildDirectory, dataEnginesDirectory, targetName) {
  assertExactDisposableDirectory(
    buildDirectory,
    path.join(dataEnginesDirectory, path.basename(buildDirectory)),
    dataEnginesDirectory,
    'qmake build directory',
  );
  if (fs.existsSync(buildDirectory)) {
    const markerFile = path.join(buildDirectory, BUILD_MARKER_FILE);
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    } catch (error) {
      throw createError(
        'UNSAFE_BUILD_DIRECTORY',
        `Refusing to replace a build directory not owned by this generator: ${buildDirectory}`,
        { markerFile, cause: error.message },
      );
    }
    if (!isPlainObject(marker)
        || marker.generator !== GENERATOR_ID
        || marker.targetName !== targetName) {
      throw createError(
        'UNSAFE_BUILD_DIRECTORY',
        `Refusing to replace a build directory not owned by this generator: ${buildDirectory}`,
      );
    }
    fs.rmSync(buildDirectory, { recursive: true, force: true });
  }
  fs.mkdirSync(buildDirectory, { recursive: true });
  writeJson(path.join(buildDirectory, BUILD_MARKER_FILE), {
    generator: GENERATOR_ID,
    targetName,
    kitName: REQUESTED_QT_KIT,
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cppHeaderGuard(targetName) {
  return `${targetName.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_H`;
}

function rewriteHeader(template, config) {
  const guard = cppHeaderGuard(config.targetName);
  let output = template;
  output = output.replace(/#ifndef\s+JUSTFLOAT_H\b/, `#ifndef ${guard}`);
  output = output.replace(/#define\s+JUSTFLOAT_H\b/, `#define ${guard}`);
  output = output.replace(/#endif\s*\/\/\s*JUSTFLOAT_H/g, `#endif // ${guard}`);
  output = output.replace(/\bJustFloat\b/g, config.className);
  output = output.replace(
    /Q_PLUGIN_METADATA\s*\(\s*IID\s+"[^"]+"\s*\)/,
    `Q_PLUGIN_METADATA(IID "VOFA+.Plugin.${config.className}")`,
  );

  if (!output.includes(`class ${config.className}`)
      || !output.includes(`VOFA+.Plugin.${config.className}`)) {
    throw createError('TEMPLATE_REWRITE_FAILED', 'Could not rewrite the JustFloat header template.');
  }
  return output;
}

function findMatchingBrace(source, openingBraceIndex) {
  let depth = 0;
  let state = 'code';

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (character === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote') {
      if (character === '\\') {
        index += 1;
      } else if ((state === 'single-quote' && character === '\'')
          || (state === 'double-quote' && character === '"')) {
        state = 'code';
      }
      continue;
    }

    if (character === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (character === '\'') {
      state = 'single-quote';
      continue;
    }
    if (character === '"') {
      state = 'double-quote';
      continue;
    }
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function sortedFields(config) {
  return config.fields
    .map((field, originalIndex) => ({ ...field, originalIndex }))
    .sort((left, right) => (
      left.wordIndex - right.wordIndex
      || left.bitOffset - right.bitOffset
      || left.originalIndex - right.originalIndex
    ));
}

function littleEndianWordExpression(wordIndex) {
  const byteIndex = wordIndex * WORD_SIZE;
  return [
    `static_cast<quint32>(bytes[${byteIndex}])`,
    `(static_cast<quint32>(bytes[${byteIndex + 1}]) << 8)`,
    `(static_cast<quint32>(bytes[${byteIndex + 2}]) << 16)`,
    `(static_cast<quint32>(bytes[${byteIndex + 3}]) << 24)`,
  ].join('\n            | ');
}

function parserLines(config) {
  const fields = sortedFields(config);
  const emittedWords = new Set();
  const lines = [];

  fields.forEach((field, channelIndex) => {
    if (!emittedWords.has(field.wordIndex)) {
      emittedWords.add(field.wordIndex);
      lines.push(`    const quint32 word${field.wordIndex} = ${littleEndianWordExpression(field.wordIndex)};`);
    }

    const word = `word${field.wordIndex}`;
    switch (field.type) {
      case 'bit':
        lines.push(`    dd.append(static_cast<float>((${word} >> ${field.bitOffset}) & 0x1u));`);
        break;
      case 'uint8':
        lines.push(`    dd.append(static_cast<float>((${word} >> ${field.bitOffset}) & 0xffu));`);
        break;
      case 'uint16':
        lines.push(`    dd.append(static_cast<float>((${word} >> ${field.bitOffset}) & 0xffffu));`);
        break;
      case 'uint32':
        lines.push(`    dd.append(static_cast<float>(${word}));`);
        break;
      case 'float':
        lines.push(`    float value${channelIndex} = 0.0f;`);
        lines.push(`    static_assert(sizeof(value${channelIndex}) == sizeof(${word}), "float must be 32 bits");`);
        lines.push(`    std::memcpy(&value${channelIndex}, &${word}, sizeof(value${channelIndex}));`);
        lines.push(`    dd.append(value${channelIndex});`);
        break;
      default:
        throw createError('INVALID_CONFIG', `Unsupported field type: ${field.type}`);
    }
  });

  return lines.join('\n');
}

function processingFrameFunction(config) {
  return `bool ${config.className}::ProcessingFrame(char *data, int count, QVector<float> &dd)\n`
    + `{\n`
    + `    const int expectedCount = (${config.wordCount} * 4) + 4;\n`
    + `    if (data == nullptr || count != expectedCount)\n`
    + `        return false;\n\n`
    + `    const unsigned char *bytes = reinterpret_cast<const unsigned char *>(data);\n`
    + `${parserLines(config)}\n`
    + `    return true;\n`
    + `}`;
}

function replaceProcessingFrame(source, config) {
  const signature = new RegExp(
    `bool\\s+${escapeRegExp(config.className)}::ProcessingFrame\\s*\\([^)]*\\)\\s*\\{`,
    'm',
  );
  const match = signature.exec(source);
  if (!match) {
    throw createError('TEMPLATE_REWRITE_FAILED', 'Could not find ProcessingFrame in the JustFloat source template.');
  }
  const openingBrace = source.indexOf('{', match.index);
  const closingBrace = findMatchingBrace(source, openingBrace);
  if (closingBrace < 0) {
    throw createError('TEMPLATE_REWRITE_FAILED', 'ProcessingFrame has unmatched braces in the JustFloat source template.');
  }
  return source.slice(0, match.index)
    + processingFrameFunction(config)
    + source.slice(closingBrace + 1);
}

function rewriteSource(template, config) {
  let output = template;
  output = output.replace(
    /#include\s+"justfloat\.h"/,
    `#include "${config.targetName}.h"`,
  );
  output = output.replace(/\bJustFloat\b/g, config.className);
  if (!/^#include\s+<cstring>\s*$/m.test(output)) {
    const ownHeader = `#include "${config.targetName}.h"`;
    output = output.replace(ownHeader, `${ownHeader}\n#include <cstring>`);
  }
  output = replaceProcessingFrame(output, config);

  if (!output.includes(`${config.className}::ProcessingDatas`)
      || output.includes('JustFloat::')) {
    throw createError('TEMPLATE_REWRITE_FAILED', 'Could not rewrite the JustFloat source template.');
  }
  return output;
}

function rewriteProject(template, config) {
  let output = template;
  output = output.replace(/^TARGET\s*=\s*justfloat\s*$/m, `TARGET = ${config.targetName}`);
  output = output.replace(/\bjustfloat\.cpp\b/g, `${config.targetName}.cpp`);
  output = output.replace(/\bjustfloat\.h\b/g, `${config.targetName}.h`);

  if (!new RegExp(`^TARGET\\s*=\\s*${escapeRegExp(config.targetName)}\\s*$`, 'm').test(output)
      || !output.includes('../shared/')) {
    throw createError('TEMPLATE_REWRITE_FAILED', 'Could not rewrite the JustFloat qmake project template.');
  }
  return output;
}

function descriptionLayout(config) {
  return sortedFields(config).map((field, channelIndex) => {
    const width = FIELD_WIDTHS[field.type];
    const bits = width === 1
      ? `bit ${field.bitOffset}`
      : `bits ${field.bitOffset}-${field.bitOffset + width - 1}`;
    const name = field.name || `channel_${channelIndex}`;
    return `- ch${channelIndex} ${name}: word[${field.wordIndex}] ${bits}, ${field.type}`;
  }).join('\n');
}

function descriptorExample(config) {
  const payloadBytes = config.wordCount * WORD_SIZE;
  return [
    `unsigned char frame[${payloadBytes + FRAME_TAIL_SIZE}] = {0};`,
    `/* Fill bytes 0..${payloadBytes - 1} using the configured little-endian layout. */`,
    `frame[${payloadBytes}] = 0x00;`,
    `frame[${payloadBytes + 1}] = 0x00;`,
    `frame[${payloadBytes + 2}] = 0x80;`,
    `frame[${payloadBytes + 3}] = 0x7f;`,
    'write((char *)frame, sizeof(frame));',
  ].join('\n');
}

function rewriteDescriptor(templateObject, config) {
  const result = JSON.parse(JSON.stringify(templateObject));
  DESCRIPTION_LANGUAGES.forEach((language) => {
    const inherited = isPlainObject(result[language]) ? result[language] : {};
    result[language] = {
      ...inherited,
      format: config.descriptions[language].format,
      example: config.descriptions[language].example,
      url: config.descriptions[language].url,
    };
  });
  return result;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function uniqueSiblingPath(finalPath, purpose) {
  const directory = path.dirname(finalPath);
  const name = path.basename(finalPath);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = crypto.randomBytes(12).toString('hex');
    const candidate = path.join(directory, `.${name}.${purpose}-${process.pid}-${token}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw createError(
    'TEMPORARY_PATH_FAILED',
    `Could not allocate a temporary sibling path for ${finalPath}.`,
  );
}

function assertReplaceableOutputFile(finalPath) {
  if (!fs.existsSync(finalPath)) return;
  const stat = fs.lstatSync(finalPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw createError(
      'UNSAFE_OUTPUT_FILE',
      `Refusing to replace a non-regular output file: ${finalPath}`,
    );
  }
}

function unlinkTemporaryFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (stat.isFile() || stat.isSymbolicLink()) fs.unlinkSync(filePath);
}

/**
 * Replace one or more already-written sibling files as one recoverable unit.
 * Each prior output is renamed out of the way first. If any commit rename
 * fails, every committed file is removed and every backup is restored.
 */
function commitStagedFiles(items) {
  const destinations = new Set();
  items.forEach(({ stagedPath, finalPath }) => {
    const destinationKey = process.platform === 'win32'
      ? path.resolve(finalPath).toLowerCase()
      : path.resolve(finalPath);
    if (destinations.has(destinationKey)) {
      throw createError('DUPLICATE_OUTPUT', `Duplicate output destination: ${finalPath}`);
    }
    destinations.add(destinationKey);
    assertFile(stagedPath, 'staged output');
    if (!samePath(path.dirname(stagedPath), path.dirname(finalPath))) {
      throw createError(
        'UNSAFE_OUTPUT_FILE',
        `Staged output must be a sibling of its destination: ${stagedPath}`,
      );
    }
    assertReplaceableOutputFile(finalPath);
  });

  const backups = [];
  const committed = [];
  try {
    items.forEach(({ finalPath }) => {
      if (!fs.existsSync(finalPath)) return;
      const backupPath = uniqueSiblingPath(finalPath, 'vofa-backup');
      fs.renameSync(finalPath, backupPath);
      backups.push({ finalPath, backupPath });
    });
    items.forEach(({ stagedPath, finalPath }) => {
      fs.renameSync(stagedPath, finalPath);
      committed.push({ stagedPath, finalPath });
    });
  } catch (error) {
    const rollbackErrors = [];
    committed.slice().reverse().forEach(({ finalPath }) => {
      try {
        unlinkTemporaryFile(finalPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    });
    backups.slice().reverse().forEach(({ finalPath, backupPath }) => {
      try {
        if (fs.existsSync(backupPath)) fs.renameSync(backupPath, finalPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    });
    items.forEach(({ stagedPath }) => {
      try {
        unlinkTemporaryFile(stagedPath);
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError.message);
      }
    });
    throw createError(
      rollbackErrors.length > 0 ? 'ARTIFACT_ROLLBACK_FAILED' : 'ARTIFACT_COMMIT_FAILED',
      rollbackErrors.length > 0
        ? `Could not commit runtime artifacts and rollback was incomplete: ${rollbackErrors.join('; ')}`
        : `Could not commit runtime artifacts; prior outputs were restored: ${error.message}`,
      { cause: error.message, rollbackErrors, backups },
    );
  }

  const warnings = [];
  backups.forEach(({ backupPath }) => {
    try {
      unlinkTemporaryFile(backupPath);
    } catch (error) {
      warnings.push(`Could not remove obsolete output backup ${backupPath}: ${error.message}`);
    }
  });
  return warnings;
}

function writeJsonAtomically(finalPath, value) {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const stagedPath = uniqueSiblingPath(finalPath, 'vofa-staged');
  try {
    writeJson(stagedPath, value);
    return commitStagedFiles([{ stagedPath, finalPath }]);
  } finally {
    unlinkTemporaryFile(stagedPath);
  }
}

function commitRuntimeArtifacts(descriptor, builtDll, descriptionFile, dllFile) {
  fs.mkdirSync(path.dirname(descriptionFile), { recursive: true });
  fs.mkdirSync(path.dirname(dllFile), { recursive: true });
  const stagedDescription = uniqueSiblingPath(descriptionFile, 'vofa-staged');
  const stagedDll = uniqueSiblingPath(dllFile, 'vofa-staged');
  try {
    writeJson(stagedDescription, descriptor);
    fs.copyFileSync(builtDll, stagedDll, fs.constants.COPYFILE_EXCL);
    return commitStagedFiles([
      { stagedPath: stagedDescription, finalPath: descriptionFile },
      { stagedPath: stagedDll, finalPath: dllFile },
    ]);
  } finally {
    unlinkTemporaryFile(stagedDescription);
    unlinkTemporaryFile(stagedDll);
  }
}

function installStagedSourceDirectory(
  stagingDirectory,
  sourceDirectory,
  replacingOwnedDirectory,
) {
  let backupDirectory = null;
  if (replacingOwnedDirectory) {
    backupDirectory = uniqueSiblingPath(sourceDirectory, 'vofa-source-backup');
    fs.renameSync(sourceDirectory, backupDirectory);
  }

  try {
    fs.renameSync(stagingDirectory, sourceDirectory);
  } catch (error) {
    if (backupDirectory && fs.existsSync(backupDirectory)) {
      try {
        fs.renameSync(backupDirectory, sourceDirectory);
      } catch (rollbackError) {
        throw createError(
          'SOURCE_ROLLBACK_FAILED',
          `Could not install generated source and restore the prior directory. The prior source remains at ${backupDirectory}.`,
          { cause: error.message, rollbackError: rollbackError.message, backupDirectory },
        );
      }
    }
    throw createError(
      'SOURCE_COMMIT_FAILED',
      `Could not install generated source; the prior directory was restored: ${error.message}`,
    );
  }

  if (!backupDirectory) return [];
  try {
    fs.rmSync(backupDirectory, { recursive: true, force: true });
    return [];
  } catch (error) {
    return [`Could not remove obsolete source backup ${backupDirectory}: ${error.message}`];
  }
}

/**
 * Generate a standalone qmake plugin project from the repository's real
 * JustFloat templates. The function is synchronous so an Electron IPC handler
 * can either return it directly or `await` it.
 */
function generateEngine(config, options = {}) {
  const normalized = requireValidConfig(config);
  const repository = requireRepositoryLayout(options.repoRoot);
  const repoRoot = repository.repoRoot;
  const dataEnginesDirectory = repository.dataEnginesDirectory;
  const templateDirectory = path.join(dataEnginesDirectory, 'justfloat');
  const generatedDirectory = path.join(dataEnginesDirectory, 'generated');
  const sourceDirectory = path.join(dataEnginesDirectory, normalized.targetName);

  const templates = {
    header: path.join(templateDirectory, 'justfloat.h'),
    source: path.join(templateDirectory, 'justfloat.cpp'),
    project: path.join(templateDirectory, 'justfloat.pro'),
    description: path.join(generatedDirectory, 'justfloat.json'),
  };
  Object.entries(templates).forEach(([name, filePath]) => assertFile(filePath, `${name} template`));

  const replacingOwnedDirectory = assertReplaceableEngineDirectory(
    sourceDirectory,
    dataEnginesDirectory,
    normalized.targetName,
  );
  const outputFiles = {
    header: path.join(sourceDirectory, `${normalized.targetName}.h`),
    source: path.join(sourceDirectory, `${normalized.targetName}.cpp`),
    project: path.join(sourceDirectory, `${normalized.targetName}.pro`),
    description: path.join(generatedDirectory, `${normalized.targetName}.json`),
    dll: path.join(generatedDirectory, 'win64', `${normalized.targetName}.dll`),
    config: path.join(sourceDirectory, GENERATOR_MARKER_FILE),
  };
  if (!replacingOwnedDirectory) {
    const collidingArtifact = [outputFiles.description, outputFiles.dll]
      .find((filePath) => fs.existsSync(filePath));
    if (collidingArtifact && options.allowExistingArtifacts !== true) {
      throw createError(
        'OUTPUT_EXISTS',
        `Refusing to overwrite an existing output that is not associated with a generator-owned source directory: ${collidingArtifact}`,
        {
          artifacts: [outputFiles.description, outputFiles.dll]
            .filter((filePath) => fs.existsSync(filePath)),
          targetName: normalized.targetName,
          requiresConfirmation: true,
        },
      );
    }
  }

  const headerTemplate = fs.readFileSync(templates.header, 'utf8');
  const sourceTemplate = fs.readFileSync(templates.source, 'utf8');
  const projectTemplate = fs.readFileSync(templates.project, 'utf8');
  let descriptorTemplate;
  try {
    descriptorTemplate = JSON.parse(fs.readFileSync(templates.description, 'utf8'));
  } catch (error) {
    throw createError(
      'INVALID_TEMPLATE',
      `The JustFloat description template is not valid JSON: ${error.message}`,
    );
  }

  const descriptor = rewriteDescriptor(descriptorTemplate, normalized);
  const stagingDirectory = fs.mkdtempSync(path.join(
    dataEnginesDirectory,
    `.${normalized.targetName}.vofa-builder-`,
  ));
  let warnings = [];
  try {
    fs.writeFileSync(
      path.join(stagingDirectory, `${normalized.targetName}.h`),
      rewriteHeader(headerTemplate, normalized),
      'utf8',
    );
    fs.writeFileSync(
      path.join(stagingDirectory, `${normalized.targetName}.cpp`),
      rewriteSource(sourceTemplate, normalized),
      'utf8',
    );
    fs.writeFileSync(
      path.join(stagingDirectory, `${normalized.targetName}.pro`),
      rewriteProject(projectTemplate, normalized),
      'utf8',
    );
    writeJson(path.join(stagingDirectory, GENERATOR_MARKER_FILE), {
      generator: GENERATOR_ID,
      version: CONFIG_VERSION,
      targetName: normalized.targetName,
      config: normalized,
    });

    warnings = warnings.concat(installStagedSourceDirectory(
      stagingDirectory,
      sourceDirectory,
      replacingOwnedDirectory,
    ));
  } finally {
    if (fs.existsSync(stagingDirectory)) {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
  }

  if (options.deferDescription !== true) {
    warnings = warnings.concat(writeJsonAtomically(outputFiles.description, descriptor));
  }

  return {
    success: true,
    config: normalized,
    repoRoot,
    dataEnginesDirectory,
    sourceDirectory,
    headerFile: outputFiles.header,
    sourceFile: outputFiles.source,
    projectFile: outputFiles.project,
    descriptionFile: outputFiles.description,
    configFile: outputFiles.config,
    descriptor,
    descriptionDeferred: options.deferDescription === true,
    warnings,
  };
}

function uniqueExistingFiles(candidates) {
  const seen = new Set();
  const result = [];
  candidates.filter(Boolean).forEach((candidate) => {
    const resolved = path.resolve(candidate.replace(/^"|"$/g, ''));
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      seen.add(key);
      result.push(resolved);
    }
  });
  return result;
}

function findOnPath(command) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  const hasExtension = path.extname(command) !== '';
  const candidates = [];
  pathEntries.forEach((entry) => {
    const directory = entry.replace(/^"|"$/g, '');
    if (!directory) return;
    if (hasExtension) {
      candidates.push(path.join(directory, command));
    } else {
      extensions.forEach((extension) => candidates.push(path.join(directory, `${command}${extension}`)));
    }
  });
  return uniqueExistingFiles(candidates)[0] || null;
}

function queryQmake(qmakePath) {
  if (!qmakePath) return {};
  const result = childProcess.spawnSync(qmakePath, ['-query'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { queryError: result.error ? result.error.message : String(result.stderr || '').trim() };
  }

  const values = {};
  String(result.stdout || '').split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(':');
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  });
  return values;
}

function qmakeKitDetails(qmakePath) {
  const query = queryQmake(qmakePath);
  const qtVersion = query.QT_VERSION || null;
  const qtInstallPrefix = query.QT_INSTALL_PREFIX || null;
  const qmakeSpec = query.QMAKE_XSPEC || query.QMAKE_SPEC || null;
  const evidence = [qmakePath, qtInstallPrefix, qmakeSpec]
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .toLowerCase();
  return {
    qmakePath,
    query,
    qtVersion,
    qtInstallPrefix,
    qmakeSpec,
    isRequestedQtKit: qtVersion === REQUESTED_QT_VERSION
      && evidence.includes('msvc2017_64')
      && qmakeSpec === 'win32-msvc',
  };
}

function vcVarsSupportsV141(vcVarsPath) {
  if (!vcVarsPath) return false;
  const resolved = path.resolve(vcVarsPath);
  if (path.basename(resolved).toLowerCase() !== 'vcvarsall.bat') return false;
  const buildDirectory = path.dirname(resolved);
  const auxiliaryDirectory = path.dirname(buildDirectory);
  const vcDirectory = path.dirname(auxiliaryDirectory);
  if (!samePath(path.join(vcDirectory, 'Auxiliary', 'Build', path.basename(resolved)), resolved)) {
    return false;
  }
  const toolsDirectory = path.join(vcDirectory, 'Tools', 'MSVC');
  try {
    return fs.readdirSync(toolsDirectory, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory() || !/^14\.16(?:\.|$)/.test(entry.name)) return false;
      return fs.existsSync(path.join(
        toolsDirectory,
        entry.name,
        'bin',
        'Hostx64',
        'x64',
        'cl.exe',
      ));
    });
  } catch (_) {
    return false;
  }
}

function findVcVarsWithV141() {
  const candidates = [];
  if (process.env.VCVARSALL) candidates.push(process.env.VCVARSALL);
  if (process.env.VSINSTALLDIR) {
    candidates.push(path.join(process.env.VSINSTALLDIR, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat'));
  }
  candidates.push('D:\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat');

  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vsWhereCandidates = uniqueExistingFiles([
    path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    findOnPath('vswhere.exe'),
  ]);
  if (vsWhereCandidates.length > 0) {
    const v141Query = childProcess.spawnSync(vsWhereCandidates[0], [
      '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.v141.x86.x64',
      '-property', 'installationPath',
      '-latest',
    ], { encoding: 'utf8', windowsHide: true });
    if (!v141Query.error && v141Query.status === 0 && String(v141Query.stdout).trim()) {
      candidates.push(path.join(
        String(v141Query.stdout).trim(),
        'VC', 'Auxiliary', 'Build', 'vcvarsall.bat',
      ));
    }

    const query = childProcess.spawnSync(vsWhereCandidates[0], [
      '-version', '[15.0,16.0)',
      '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
      '-latest',
    ], { encoding: 'utf8', windowsHide: true });
    if (!query.error && query.status === 0 && String(query.stdout).trim()) {
      candidates.push(path.join(
        String(query.stdout).trim(),
        'VC', 'Auxiliary', 'Build', 'vcvarsall.bat',
      ));
    }
  }

  ['BuildTools', 'Community', 'Professional', 'Enterprise'].forEach((edition) => {
    candidates.push(path.join(
      programFilesX86,
      'Microsoft Visual Studio',
      '2017',
      edition,
      'VC',
      'Auxiliary',
      'Build',
      'vcvarsall.bat',
    ));
    candidates.push(path.join(
      programFilesX86,
      'Microsoft Visual Studio',
      '2022',
      edition,
      'VC',
      'Auxiliary',
      'Build',
      'vcvarsall.bat',
    ));
  });
  return uniqueExistingFiles(candidates).find(vcVarsSupportsV141) || null;
}

function detectEnvironment(options = {}) {
  const repository = inspectRepositoryLayout(options.repoRoot);
  const repoRoot = repository.repoRoot;
  const systemDrive = process.env.SystemDrive || 'C:';
  const qtRoots = [
    process.env.QTDIR,
    process.env.QT_ROOT,
    'D:\\QT\\Qt5.14.2\\5.14.2\\msvc2017_64',
    `${systemDrive}\\Qt\\5.14.2\\msvc2017_64`,
    `${systemDrive}\\Qt\\Qt5.14.2\\5.14.2\\msvc2017_64`,
    'C:\\Qt\\5.14.2\\msvc2017_64',
    'D:\\Qt\\5.14.2\\msvc2017_64',
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'Qt', '5.14.2', 'msvc2017_64')
      : null,
  ].filter(Boolean);

  const qmakeCandidates = uniqueExistingFiles([
    process.env.QMAKE,
    process.env.QT_QMAKE_EXECUTABLE,
    ...qtRoots.map((root) => path.join(root, 'bin', 'qmake.exe')),
    findOnPath('qmake.exe'),
    findOnPath('qmake'),
  ]);
  const qmakeDetails = qmakeCandidates.map(qmakeKitDetails);
  const selectedQmake = qmakeDetails.find((details) => details.isRequestedQtKit)
    || qmakeDetails[0]
    || qmakeKitDetails(null);
  const qmakePath = selectedQmake.qmakePath;

  const qtBaseCandidates = ['D:\\QT\\Qt5.14.2', 'C:\\Qt', 'D:\\Qt'];
  if (qmakePath) {
    const normalized = qmakePath.replace(/\\/g, '/');
    const marker = normalized.toLowerCase().indexOf('/5.14.2/');
    if (marker > 0) qtBaseCandidates.unshift(normalized.slice(0, marker));
  }
  const jomPath = uniqueExistingFiles([
    process.env.JOM,
    ...qtBaseCandidates.flatMap((root) => [
      path.join(root, 'Tools', 'QtCreator', 'bin', 'jom', 'jom.exe'),
      path.join(root, 'Tools', 'QtCreator', 'bin', 'jom.exe'),
    ]),
    findOnPath('jom.exe'),
    findOnPath('jom'),
  ])[0] || null;

  const vcVarsPath = findVcVarsWithV141();
  const cmdPath = uniqueExistingFiles([
    process.env.ComSpec,
    process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'cmd.exe')
      : null,
    findOnPath('cmd.exe'),
  ])[0] || null;

  const qmakeQuery = selectedQmake.query;
  const qtVersion = selectedQmake.qtVersion;
  const qtInstallPrefix = selectedQmake.qtInstallPrefix;
  const qmakeSpec = selectedQmake.qmakeSpec;
  const isRequestedQtKit = selectedQmake.isRequestedQtKit;

  const missing = [];
  const warnings = [];
  if (!repository.valid) {
    missing.push('valid VOFA+ repository root');
    warnings.push(repository.message);
  }
  if (process.platform !== 'win32') missing.push('Windows host');
  if (!cmdPath) missing.push('cmd.exe');
  if (!qmakePath) {
    missing.push('Qt 5.14.2 msvc2017_64 qmake.exe');
  } else if (!isRequestedQtKit) {
    missing.push('exact Qt 5.14.2 msvc2017_64 kit');
    warnings.push(`Detected qmake is not ${REQUESTED_QT_KIT}: ${qmakePath}`);
  }
  if (!jomPath) missing.push('jom.exe');
  if (!vcVarsPath) missing.push('Visual Studio MSVC v141 (14.16) x64 environment');
  if (qmakeQuery.queryError) warnings.push(`qmake -query failed: ${qmakeQuery.queryError}`);

  return {
    platform: process.platform,
    kitName: REQUESTED_QT_KIT,
    requestedKit: REQUESTED_QT_KIT,
    repoRoot,
    dataEnginesDir: repository.dataEnginesDirectory,
    repositoryReady: repository.valid,
    repositoryValid: repository.valid,
    repositoryMissing: repository.missing,
    ready: missing.length === 0,
    buildReady: missing.length === 0,
    missing,
    warnings,
    cmdPath,
    qmakePath,
    jomPath,
    vcVarsPath,
    hasV141Toolset: vcVarsSupportsV141(vcVarsPath),
    qtVersion,
    qtInstallPrefix,
    qmakeSpec,
    isRequestedQtKit,
  };
}

function getEnvironment(repoRootOrEnvironment) {
  if (isPlainObject(repoRootOrEnvironment)) {
    return environmentForBuild(repoRootOrEnvironment);
  }
  return detectEnvironment({ repoRoot: repoRootOrEnvironment });
}

function resolveProvidedTool(value, fallback) {
  if (!value) return fallback || null;
  const unquoted = String(value).replace(/^"|"$/g, '');
  if (fs.existsSync(unquoted) && fs.statSync(unquoted).isFile()) {
    return path.resolve(unquoted);
  }
  return findOnPath(unquoted) || null;
}

function environmentForBuild(options) {
  const detected = detectEnvironment({ repoRoot: options.repoRoot });
  const environment = {
    ...detected,
    qmakePath: resolveProvidedTool(options.qmakePath, detected.qmakePath),
    jomPath: resolveProvidedTool(options.jomPath, detected.jomPath),
    vcVarsPath: resolveProvidedTool(options.vcVarsPath, detected.vcVarsPath),
  };

  const qmake = qmakeKitDetails(environment.qmakePath);
  environment.qtVersion = qmake.qtVersion;
  environment.qtInstallPrefix = qmake.qtInstallPrefix;
  environment.qmakeSpec = qmake.qmakeSpec;
  environment.isRequestedQtKit = qmake.isRequestedQtKit;
  environment.hasV141Toolset = vcVarsSupportsV141(environment.vcVarsPath);

  const missing = [];
  const warnings = Array.isArray(detected.warnings) ? [...detected.warnings] : [];
  if (!environment.repositoryReady) missing.push('valid VOFA+ repository root');
  if (process.platform !== 'win32') missing.push('Windows host');
  if (!environment.cmdPath) missing.push('cmd.exe');
  if (!environment.qmakePath) missing.push('qmake.exe');
  else if (!environment.isRequestedQtKit) {
    missing.push('exact Qt 5.14.2 msvc2017_64 kit');
    warnings.push(`Selected qmake is not ${REQUESTED_QT_KIT}: ${environment.qmakePath}`);
  }
  if (!environment.jomPath) missing.push('jom.exe');
  if (!environment.vcVarsPath || !environment.hasV141Toolset) {
    missing.push('Visual Studio MSVC v141 (14.16) x64 environment');
  }
  environment.missing = [...new Set(missing)];
  environment.warnings = [...new Set(warnings)];
  environment.ready = missing.length === 0;
  environment.buildReady = environment.ready;
  return environment;
}

function quoteForCmd(value) {
  const text = String(value);
  if (/["\r\n]/.test(text)) {
    throw createError('INVALID_TOOL_PATH', `A build path contains an unsupported character: ${text}`);
  }
  return `"${text}"`;
}

function decodeBuildOutputBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (buffer.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_) {
    return new TextDecoder('gb18030').decode(buffer);
  }
}

function createBuildOutputDecoder(onText) {
  let pending = Buffer.alloc(0);
  const emit = (buffer) => {
    if (buffer.length > 0) onText(decodeBuildOutputBuffer(buffer));
  };
  return {
    push(chunk) {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || '');
      if (incoming.length === 0) return;
      pending = pending.length === 0 ? incoming : Buffer.concat([pending, incoming]);
      let newlineIndex = pending.indexOf(0x0a);
      while (newlineIndex !== -1) {
        emit(pending.subarray(0, newlineIndex + 1));
        pending = pending.subarray(newlineIndex + 1);
        newlineIndex = pending.indexOf(0x0a);
      }
    },
    end() {
      emit(pending);
      pending = Buffer.alloc(0);
    },
  };
}

function runBuildCommand(environment, projectFile, buildDirectory, onOutput) {
  const steps = [
    `call ${quoteForCmd(environment.vcVarsPath)} x64 -vcvars_ver=14.16`,
    `${quoteForCmd(environment.qmakePath)} ${quoteForCmd(projectFile)} -spec win32-msvc "CONFIG+=release" "CONFIG-=debug"`,
    `${quoteForCmd(environment.jomPath)} /NOLOGO`,
  ];
  const scriptFile = path.join(buildDirectory, 'build-release.cmd');
  const script = [
    '@echo off',
    'chcp 65001 >nul',
    steps[0],
    'if errorlevel 1 exit /b %errorlevel%',
    steps[1],
    'if errorlevel 1 exit /b %errorlevel%',
    steps[2],
    'exit /b %errorlevel%',
    '',
  ].join('\r\n');
  fs.writeFileSync(scriptFile, script, 'utf8');
  const command = `${quoteForCmd(environment.cmdPath)} /d /s /c ${quoteForCmd(scriptFile)}`;

  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      environment.cmdPath,
      ['/d', '/s', '/c', scriptFile],
      {
        cwd: buildDirectory,
        windowsHide: true,
        env: process.env,
      },
    );
    let output = '';

    const forward = (text, stream) => {
      output += text;
      if (typeof onOutput === 'function') {
        try {
          onOutput(text, stream);
        } catch (_) {
          // A renderer log callback must not terminate the compiler process.
        }
      }
    };
    const stdoutDecoder = createBuildOutputDecoder((text) => forward(text, 'stdout'));
    const stderrDecoder = createBuildOutputDecoder((text) => forward(text, 'stderr'));
    child.stdout.on('data', (chunk) => stdoutDecoder.push(chunk));
    child.stderr.on('data', (chunk) => stderrDecoder.push(chunk));
    child.on('error', (error) => {
      reject(createError('BUILD_START_FAILED', `Could not start the build: ${error.message}`, { output }));
    });
    child.on('close', (exitCode) => {
      stdoutDecoder.end();
      stderrDecoder.end();
      if (exitCode === 0) {
        resolve({ command, scriptFile, steps, exitCode, output });
      } else {
        reject(createError(
          'BUILD_FAILED',
          `qmake/jom exited with code ${exitCode}.`,
          { command, scriptFile, steps, exitCode, output },
        ));
      }
    });
  });
}

function findBuiltDll(buildDirectory, targetName) {
  const expectedName = `${targetName}.dll`.toLowerCase();
  const matches = [];
  const pending = [buildDirectory];
  while (pending.length > 0) {
    const current = pending.pop();
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile() && entry.name.toLowerCase() === expectedName) {
        matches.push(candidate);
      }
    });
  }
  matches.sort((left, right) => {
    const leftDepth = path.relative(buildDirectory, left).split(path.sep).length;
    const rightDepth = path.relative(buildDirectory, right).split(path.sep).length;
    return leftDepth - rightDepth || left.localeCompare(right);
  });
  return matches[0] || null;
}

async function buildEngine(config, options = {}) {
  const environment = environmentForBuild(options);
  if (!environment.ready) {
    throw createError(
      'ENVIRONMENT_NOT_READY',
      `The requested ${REQUESTED_QT_KIT} build environment is incomplete: ${environment.missing.join(', ')}`,
      environment,
    );
  }
  const generation = generateEngine(config, {
    repoRoot: options.repoRoot,
    allowExistingArtifacts: options.allowExistingArtifacts === true,
    deferDescription: true,
  });

  const generatedDirectory = path.join(generation.dataEnginesDirectory, 'generated');
  const buildDirectoryName = `build-${generation.config.targetName}-${REQUESTED_QT_KIT}`;
  // The repository already ignores directories containing "build-"; keeping
  // shadow-build artifacts here avoids polluting either generated deliverables
  // or source-control status while also avoiding legacy build-<target> paths.
  const buildRoot = path.join(generation.dataEnginesDirectory, 'build-vofa-engine-builder');
  if (fs.existsSync(buildRoot)) {
    const buildRootStat = fs.lstatSync(buildRoot);
    if (!buildRootStat.isDirectory() || buildRootStat.isSymbolicLink()) {
      throw createError('UNSAFE_BUILD_DIRECTORY', `Invalid generator build root: ${buildRoot}`);
    }
  } else {
    fs.mkdirSync(buildRoot);
  }
  const buildDirectory = path.join(buildRoot, buildDirectoryName);
  resetOwnedBuildDirectory(
    buildDirectory,
    buildRoot,
    generation.config.targetName,
  );

  const commandRunner = typeof options.commandRunner === 'function'
    ? options.commandRunner
    : runBuildCommand;
  const build = await commandRunner(
    environment,
    generation.projectFile,
    buildDirectory,
    options.onOutput,
  );
  const builtDll = findBuiltDll(buildDirectory, generation.config.targetName);
  if (!builtDll) {
    throw createError(
      'DLL_NOT_FOUND',
      `Build succeeded but ${generation.config.targetName}.dll was not found under ${buildDirectory}.`,
      { buildDirectory, output: build.output },
    );
  }

  const win64Directory = path.join(generatedDirectory, 'win64');
  fs.mkdirSync(win64Directory, { recursive: true });
  const dllFile = path.join(win64Directory, `${generation.config.targetName}.dll`);
  const artifactWarnings = commitRuntimeArtifacts(
    generation.descriptor,
    builtDll,
    generation.descriptionFile,
    dllFile,
  );

  return {
    ...generation,
    environment,
    buildDirectory,
    builtDll,
    dllFile,
    command: build.command,
    exitCode: build.exitCode,
    output: build.output,
    descriptionDeferred: false,
    warnings: [...generation.warnings, ...artifactWarnings],
  };
}

module.exports = {
  deriveEngineNames,
  validateConfig,
  normalizeConfig,
  generateEngine,
  buildEngine,
  getEnvironment,
  detectEnvironment,
  inspectRepositoryLayout,
  decodeBuildOutputBuffer,
  createBuildOutputDecoder,
};
