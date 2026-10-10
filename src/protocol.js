(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProtocolModel = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const TYPES = Object.freeze({ bit: 1, uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float: 4 });
  const CRCS = Object.freeze({
    none: { label: "无校验", width: 0 },
    "crc8-smbus": { label: "CRC-8/SMBUS", width: 8, polynomial: 0x07, init: 0, xorOut: 0, reflectInput: false, reflectOutput: false },
    "crc8-maxim": { label: "CRC-8/MAXIM-DOW", width: 8, polynomial: 0x31, init: 0, xorOut: 0, reflectInput: true, reflectOutput: true },
    "crc8-sae-j1850": { label: "CRC-8/SAE-J1850", width: 8, polynomial: 0x1d, init: 0xff, xorOut: 0xff, reflectInput: false, reflectOutput: false },
    "crc16-modbus": { label: "CRC-16/MODBUS", width: 16, polynomial: 0x8005, init: 0xffff, xorOut: 0, reflectInput: true, reflectOutput: true },
    "crc16-arc": { label: "CRC-16/ARC", width: 16, polynomial: 0x8005, init: 0, xorOut: 0, reflectInput: true, reflectOutput: true },
    "crc16-xmodem": { label: "CRC-16/XMODEM", width: 16, polynomial: 0x1021, init: 0, xorOut: 0, reflectInput: false, reflectOutput: false },
    "crc16-ccitt-false": { label: "CRC-16/CCITT-FALSE", width: 16, polynomial: 0x1021, init: 0xffff, xorOut: 0, reflectInput: false, reflectOutput: false },
    "crc32-iso": { label: "CRC-32/ISO-HDLC", width: 32, polynomial: 0x04c11db7, init: 0xffffffff, xorOut: 0xffffffff, reflectInput: true, reflectOutput: true }
  });
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const cleanHex = (value) => typeof value === "string" ? value.replace(/\s/g, "").toUpperCase() : value;
  const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  function bytes(value, limit = 262144) {
    const text = cleanHex(value);
    if (typeof text !== "string" || text.length % 2 || !/^[0-9A-F]*$/.test(text)) throw new Error("十六进制数据需使用完整字节，例如 AA 55 00 01。");
    if (text.length / 2 > limit) throw new Error(`数据不能超过 ${limit} 字节。`);
    return Uint8Array.from(text.match(/../g) || [], (pair) => parseInt(pair, 16));
  }
  function defaults(mode = "words") {
    return { kind: "fixed", dataMode: mode, header: "AA55", tail: "", byteOrder: "little", dataFields: [], crc: { algorithm: "crc16-modbus", scope: "data", byteOrder: "little" } };
  }
  function normalize(value) {
    if (!object(value)) throw new Error("protocol 必须是对象。");
    const crc = object(value.crc) ? value.crc : {};
    return {
      kind: value.kind,
      dataMode: value.dataMode,
      header: cleanHex(value.header),
      tail: cleanHex(value.tail),
      byteOrder: value.byteOrder,
      ...(value.headerValues !== undefined ? { headerValues: Array.isArray(value.headerValues) ? value.headerValues.map(cleanHex) : value.headerValues } : {}),
      ...(value.repeatWords !== undefined ? { repeatWords: value.repeatWords } : {}),
      ...(value.checks !== undefined ? { checks: Array.isArray(value.checks) ? value.checks.map((check) => object(check) ? {
        field: check.field, operator: check.operator,
        ...(check.operator === "eq" || check.operator === "in" ? { values: check.values } : {}),
        ...(check.operator === "range" ? { min: check.min, max: check.max } : {}),
        ...(check.operator === "mask" ? { mask: check.mask, value: check.value } : {})
      } : check) : value.checks } : {}),
      dataFields: Array.isArray(value.dataFields) ? value.dataFields.map((field) => object(field) ? {
        type: field.type, name: field.name === undefined ? "" : field.name,
        ...(field.output !== undefined ? { output: field.output } : {}),
        ...(field.type === "word" ? { mappings: Array.isArray(field.mappings) ? field.mappings.map((mapping) => object(mapping) ? { type: mapping.type, name: mapping.name ?? "", bitOffset: mapping.bitOffset, ...(mapping.output !== undefined ? { output: mapping.output } : {}) } : mapping) : field.mappings } : {}),
        ...(field.type === "reserved" ? { bytes: field.bytes } : {}),
        ...(field.type === "bit" ? { bitOffset: field.bitOffset ?? 0 } : {})
      } : field) : value.dataFields,
      crc: { algorithm: crc.algorithm, scope: crc.scope, byteOrder: crc.byteOrder,
        ...(crc.algorithm === "custom" ? { parameters: object(crc.parameters) ? Object.fromEntries(
          ["width", "polynomial", "init", "xorOut", "reflectInput", "reflectOutput"].map((key) => [key, crc.parameters[key]])
        ) : crc.parameters } : {}) }
    };
  }
  function crcParameters(crc) {
    return crc.algorithm === "custom" ? crc.parameters : CRCS[crc.algorithm];
  }
  function fieldSize(field) { return field.type === "word" ? 4 : field.type === "reserved" ? field.bytes : TYPES[field.type] || 0; }
  function fields(config) {
    const p = config.protocol;
    const list = [];
    if (p.dataMode === "custom") {
      let offset = 0;
      p.dataFields.forEach((field, index) => {
        if (field.type === "word") {
          if (!field.mappings.length) list.push({ type: "float", name: field.name || `Word ${index}`, offset, index, bitOffset: 0, width: 32, output: field.output !== false });
          else field.mappings.forEach((mapping) => list.push({ ...mapping, output: field.output !== false && mapping.output !== false, offset: offset + Math.floor(mapping.bitOffset / 8), index, bitOffset: mapping.bitOffset % 8, width: mapping.type === "bit" ? 1 : TYPES[mapping.type] * 8 }));
        } else if (field.type !== "reserved") list.push({ ...field, offset, index, bitOffset: field.type === "bit" ? field.bitOffset : 0, width: field.type === "bit" ? 1 : TYPES[field.type] * 8 });
        offset += fieldSize(field);
      });
    } else {
      const fields = [...config.fields].sort((a, b) => a.wordIndex - b.wordIndex || a.bitOffset - b.bitOffset);
      for (let word = 0; word < config.wordCount; word++) {
        const mapped = fields.filter((field) => field.wordIndex === word);
        if (!mapped.length) list.push({ type: "float", name: `Word ${word} float`, offset: word * 4, bitOffset: 0, width: 32, wordIndex: word });
        else mapped.forEach((field) => list.push({ ...field, offset: word * 4 + Math.floor(field.bitOffset / 8), bitOffset: field.bitOffset % 8, width: field.type === "bit" ? 1 : TYPES[field.type] * 8 }));
      }
    }
    return list;
  }
  function outputs(config) { return fields(config).filter((field) => field.output !== false); }
  function headerValues(p) { return p.headerValues || (p.header ? [p.header] : []); }
  function wordData(p) { return p.dataMode === "words" || p.dataFields.every((field) => field.type === "word"); }
  function layout(config) {
    const p = config.protocol;
    const headerBytes = bytes(p.header, 64).length;
    const tailBytes = bytes(p.tail, 64).length;
    const dataBytes = p.dataMode === "words" ? config.wordCount * 4 : p.dataFields.reduce((sum, field) => sum + fieldSize(field), 0);
    const crcBytes = (crcParameters(p.crc)?.width || 0) / 8;
    return { headerBytes, dataBytes, crcBytes, tailBytes, frameBytes: headerBytes + dataBytes + crcBytes + tailBytes, fields: fields(config), channels: outputs(config), dataOffset: headerBytes, crcOffset: headerBytes + dataBytes, tailOffset: headerBytes + dataBytes + crcBytes };
  }
  function validate(config) {
    const errors = [];
    const p = config.protocol;
    if (!object(p)) return ["protocol 必须是对象。"];
    if (config.version !== 3) errors.push("固定结构协议使用配置 version: 3。");
    if (!["fixed", "delimited"].includes(p.kind)) errors.push("收帧规则必须是 fixed 或 delimited。");
    if (!["words", "custom"].includes(p.dataMode)) errors.push("数据域模式必须是 words 或 custom。");
    if (!["little", "big"].includes(p.byteOrder)) errors.push("数据字节序必须是 little 或 big。");
    for (const [key, title] of [["header", "帧头"], ["tail", "帧尾"]]) {
      try { bytes(p[key], 64); } catch (error) { errors.push(`${title}：${error.message}`); }
    }
    if (!p.header && !p.tail) errors.push("无帧头协议必须配置帧尾，以确定帧边界。");
    if (p.kind === "delimited" && !p.tail) errors.push("按帧尾收帧时必须配置帧尾。");
    if (p.repeatWords !== undefined && (typeof p.repeatWords !== "boolean" || p.kind !== "delimited")) errors.push("后续 Word 仅用于按帧尾收帧，且必须是布尔值。");
    if (p.headerValues !== undefined) {
      if (!Array.isArray(p.headerValues) || !p.headerValues.length || p.headerValues.length > 32) errors.push("帧头候选需要 1–32 个值。");
      else {
        try {
          const lengths = p.headerValues.map((value) => bytes(value, 64).length);
          if (!lengths[0] || lengths.some((length) => length !== lengths[0])) errors.push("所有帧头候选必须非空、字节数一致。");
          if (p.headerValues[0] !== p.header) errors.push("帧头候选与主帧头配置不一致，请重新保存帧头节点。");
          if (new Set(p.headerValues).size !== p.headerValues.length) errors.push("帧头候选不能重复。");
        } catch (error) { errors.push("帧头候选：" + error.message); }
      }
    }
    if (!Array.isArray(p.dataFields)) errors.push("dataFields 必须是数组。");
    if (p.dataMode === "words" && Array.isArray(config.fields) && config.fields.some((field) => object(field) && field.output !== undefined && typeof field.output !== "boolean")) errors.push("Word 字段输出选项必须是布尔值。");
    else if (p.dataMode === "custom") {
      if (!p.dataFields.length || p.dataFields.length > 256) errors.push("自定义数据域需要 1–256 个字段积木。");
      p.dataFields.forEach((field, index) => {
        if (!object(field)) { errors.push(`字段 ${index + 1} 格式无效。`); return; }
        if (!Object.hasOwn(TYPES, field.type) && !["reserved", "word"].includes(field.type)) errors.push(`字段 ${index + 1} 的类型不受支持。`);
        if (typeof field.name !== "string" || field.name.length > 48) errors.push(`字段 ${index + 1} 的名称需为不超过 48 字符的文本。`);
        if (field.output !== undefined && typeof field.output !== "boolean") errors.push("字段输出选项必须是布尔值。");
        if (field.type === "reserved" && (!Number.isInteger(field.bytes) || field.bytes < 1 || field.bytes > 4096)) errors.push("保留字节数需为 1–4096。");
        if (field.type === "bit" && (!Number.isInteger(field.bitOffset) || field.bitOffset < 0 || field.bitOffset > 7)) errors.push("bit 字段的位置需为 0–7，占用一个字节容器。");
        if (field.type === "word") {
          if (!Array.isArray(field.mappings) || field.mappings.length > 32) errors.push("Word 映射需为最多 32 个字段的数组。");
          else {
            const occupied = new Set();
            for (const mapping of field.mappings) {
              if (!object(mapping) || !Object.hasOwn(TYPES, mapping.type)) { errors.push("Word 映射字段类型无效。"); continue; }
              const width = mapping.type === "bit" ? 1 : TYPES[mapping.type] * 8;
              if (typeof mapping.name !== "string" || mapping.name.length > 48) errors.push("Word 映射名称不能超过 48 字符。");
              if (mapping.output !== undefined && typeof mapping.output !== "boolean") errors.push("Word 映射输出选项必须是布尔值。");
              if (!Number.isInteger(mapping.bitOffset) || mapping.bitOffset < 0 || mapping.bitOffset + width > 32 || mapping.type !== "bit" && mapping.bitOffset % 8) { errors.push("Word 映射越界或未按字节对齐。"); continue; }
              for (let bit = mapping.bitOffset; bit < mapping.bitOffset + width; bit++) {
                if (occupied.has(bit)) errors.push("Word 映射字段不能重叠。");
                occupied.add(bit);
              }
            }
          }
        }
      });
      if (p.dataFields.every((field) => object(field) && field.type === "reserved")) errors.push("数据域至少需要一个输出字段。");
    }
    if (!object(p.crc)) errors.push("请配置校验模块。");
    else {
      if (!Object.hasOwn(CRCS, p.crc.algorithm) && p.crc.algorithm !== "custom") errors.push("未知 CRC 算法，请选择预设或自定义参数。");
      if (!["data", "header-data"].includes(p.crc.scope)) errors.push("校验范围必须是 data 或 header-data。");
      if (!["little", "big"].includes(p.crc.byteOrder)) errors.push("校验值字节序必须是 little 或 big。");
      if (p.crc.algorithm === "custom") {
        const params = p.crc.parameters;
        if (!object(params)) errors.push("自定义 CRC 参数必须是对象。");
        else {
          if (![8, 16, 32].includes(params.width)) errors.push("CRC 位宽需为 8、16 或 32。");
          const max = params.width === 32 ? 0xffffffff : Math.pow(2, params.width) - 1;
          for (const key of ["polynomial", "init", "xorOut"]) if (!Number.isInteger(params[key]) || params[key] < 0 || params[key] > max) errors.push(`CRC ${key} 超出所选位宽。`);
          if (!params.polynomial) errors.push("CRC 多项式不能为 0。");
          if (typeof params.reflectInput !== "boolean" || typeof params.reflectOutput !== "boolean") errors.push("CRC 反射选项必须是布尔值。");
        }
      }
    }
    if (!errors.length) {
      const l = layout(config);
      if (!Number.isInteger(l.dataBytes) || l.dataBytes < 1 || l.frameBytes > 65536) errors.push("数据域不能为空，整帧不能超过 65536 字节。");
      if (l.channels.length > 2048) errors.push("输出通道数不能超过 2048。");
      if (!l.channels.length) errors.push("至少需要一个输出字段。");
      if (p.checks !== undefined) {
        if (!Array.isArray(p.checks) || p.checks.length > 256) errors.push("值校验需为最多 256 项的数组。");
        else p.checks.forEach((check) => {
          if (!object(check) || !Number.isInteger(check.field) || !l.fields[check.field]) { errors.push("值校验引用的字段不存在。"); return; }
          const field = l.fields[check.field], bounds = fieldBounds(field);
          const validValue = (value) => typeof value === "number" && Number.isFinite(value) && (field.type === "float" ? Number.isFinite(Math.fround(value)) : Number.isInteger(value)) && value >= bounds.min && value <= bounds.max;
          if (["eq", "in"].includes(check.operator)) {
            if (!Array.isArray(check.values) || !check.values.length || check.values.length > 64 || check.operator === "eq" && check.values.length !== 1 || check.values.some((value) => !validValue(value))) errors.push("校验允许值必须符合字段类型；等于需 1 个值，集合需 1–64 个值。");
          } else if (check.operator === "range") {
            if (!validValue(check.min) || !validValue(check.max) || check.min > check.max) errors.push("校验范围必须符合字段类型，且下限不能大于上限。");
          } else if (check.operator === "mask") {
            if (!field.type.startsWith("uint") && field.type !== "bit" || !Number.isInteger(check.mask) || check.mask < 1 || check.mask > bounds.max || !Number.isInteger(check.value) || check.value < 0 || check.value > bounds.max || ((check.value & check.mask) >>> 0) !== check.value) errors.push("位掩码校验仅用于无符号整数或 bit，匹配值不能包含掩码之外的位。");
          } else errors.push("未知的值校验运算符。");
        });
      }
    }
    return errors;
  }
  function reflect(value, width) {
    let result = 0;
    for (let i = 0; i < width; i++) { result = result * 2 + (value & 1); value >>>= 1; }
    return result >>> 0;
  }
  function calculateCrc(data, params) {
    if (!params?.width) return 0;
    const mask = params.width === 32 ? 0xffffffff : Math.pow(2, params.width) - 1;
    const highBit = Math.pow(2, params.width - 1);
    let crc = params.init >>> 0;
    for (let byte of data) {
      if (params.reflectInput) byte = reflect(byte, 8);
      crc = (crc ^ (byte << (params.width - 8))) >>> 0;
      for (let bit = 0; bit < 8; bit++) crc = (((crc & highBit) !== 0 ? (crc << 1) ^ params.polynomial : crc << 1) & mask) >>> 0;
    }
    if (params.reflectOutput) crc = reflect(crc, params.width);
    return ((crc ^ params.xorOut) & mask) >>> 0;
  }
  function readUnsigned(data, offset, count, order) {
    let value = 0;
    for (let i = 0; i < count; i++) value = value * 256 + data[offset + (order === "little" ? count - 1 - i : i)];
    return value >>> 0;
  }
  function fieldBounds(field) {
    if (field.type === "float") return { min: -3.4028234663852886e38, max: 3.4028234663852886e38 };
    return field.type.startsWith("int") ? { min: -Math.pow(2, field.width - 1), max: Math.pow(2, field.width - 1) - 1 } : { min: 0, max: Math.pow(2, field.width) - 1 };
  }
  function readField(data, offset, field, order) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (field.type === "bit") return (data[offset] >>> field.bitOffset) & 1;
    if (field.type === "float") return view.getFloat32(offset, order === "little");
    let value = readUnsigned(data, offset, TYPES[field.type], order);
    if (field.type.startsWith("int") && value >= Math.pow(2, field.width - 1)) value -= Math.pow(2, field.width);
    return value;
  }
  function matchesCheck(value, check, field) {
    const number = (v) => field.type === "float" ? Math.fround(v) : v;
    if (check.operator === "eq" || check.operator === "in") return check.values.some((allowed) => value === number(allowed));
    if (check.operator === "range") return value >= number(check.min) && value <= number(check.max);
    return ((value & check.mask) >>> 0) === check.value;
  }
  function sampleValue(field, rules, current) {
    const bounds = fieldBounds(field), number = (value) => field.type === "float" ? Math.fround(value) : value;
    const lower = Math.max(bounds.min, ...rules.filter((rule) => rule.operator === "range").map((rule) => number(rule.min)));
    const upper = Math.min(bounds.max, ...rules.filter((rule) => rule.operator === "range").map((rule) => number(rule.max)));
    const allowed = rules.find((rule) => rule.values)?.values;
    let candidate;
    if (allowed) candidate = allowed.map(number).find((value) => rules.every((rule) => matchesCheck(value, rule, field)));
    else if (lower <= upper) {
      let mask = 0, pattern = 0, conflict = false;
      for (const rule of rules.filter((rule) => rule.operator === "mask")) {
        if (((pattern ^ rule.value) & mask & rule.mask) !== 0) conflict = true;
        mask = (mask | rule.mask) >>> 0; pattern = (pattern | rule.value) >>> 0;
      }
      if (!conflict && mask) {
        // Find the smallest unsigned value >= lower with the required bits.
        // Once a prefix exceeds the lower bound, lower bits can be minimized.
        function choose(bit, value, tight) {
          if (bit < 0) return value;
          const lowBit = (lower >>> bit) & 1;
          for (let digit = 0; digit <= 1; digit++) {
            if (tight && digit < lowBit || ((mask >>> bit) & 1) && digit !== ((pattern >>> bit) & 1)) continue;
            const found = choose(bit - 1, value + digit * Math.pow(2, bit), tight && digit === lowBit);
            if (found !== undefined) return found;
          }
        }
        candidate = choose(31, 0, true);
        if (candidate > upper) candidate = undefined;
      } else if (!conflict) candidate = number(Math.min(upper, Math.max(lower, current)));
    }
    if (candidate === undefined || !rules.every((rule) => matchesCheck(candidate, rule, field))) throw new Error("字段 " + (field.name || field.type) + " 的校验条件互相冲突。");
    return candidate;
  }
  function checkFields(data, l, p, complete = false, dataEnd = data.length) {
    let pending = false;
    for (const check of p.checks || []) {
      const field = l.fields[check.field], offset = l.dataOffset + field.offset;
      if (offset + TYPES[field.type] > dataEnd) { if (complete) return { field: field.name, reason: "missing" }; pending = true; continue; }
      const value = readField(data, offset, field, p.byteOrder);
      if (!matchesCheck(value, check, field)) return { field: field.name, actual: Number.isFinite(value) ? value : String(value), operator: check.operator };
    }
    return pending ? "pending" : null;
  }
  function decode(data, l, p) {
    const dataEnd = data.length - l.tailBytes - l.crcBytes;
    const actualFields = l.channels.filter((field) => l.dataOffset + field.offset + TYPES[field.type] <= dataEnd);
    if (p.kind === "delimited" && p.repeatWords) {
      for (let offset = l.dataOffset + l.dataBytes; offset + 4 <= dataEnd; offset += 4) actualFields.push({ type: "float", name: "后续 Word " + ((offset - l.dataOffset) / 4), offset: offset - l.dataOffset, bitOffset: 0, width: 32 });
    }
    return actualFields.map((field, channel) => {
      const offset = l.dataOffset + field.offset;
      const value = readField(data, offset, field, p.byteOrder);
      return { channel, name: field.name || `ch${channel}`, type: field.type, offset, rawValue: Number.isFinite(value) ? value : String(value), value: Number.isFinite(value) ? Math.fround(value) : String(value) };
    });
  }
  function makeSample(config) {
    const p = config.protocol, l = layout(config);
    const sample = new Uint8Array(l.frameBytes);
    sample.set(bytes(p.header)); sample.set(bytes(p.tail), l.tailOffset);
    const view = new DataView(sample.buffer);
    l.channels.forEach((field, channel) => {
      const offset = l.dataOffset + field.offset;
      const value = field.type === "float" ? channel + 1.5 : channel + 1;
      if (field.type === "bit") sample[offset] |= (value & 1) << field.bitOffset;
      else if (field.type === "float") view.setFloat32(offset, value, p.byteOrder === "little");
      else for (let i = 0; i < TYPES[field.type]; i++) sample[offset + i] = (value >>> (8 * (p.byteOrder === "little" ? i : TYPES[field.type] - 1 - i))) & 0xff;
    });
    for (let index = 0; index < l.fields.length; index++) {
      const rules = (p.checks || []).filter((check) => check.field === index);
      if (!rules.length) continue;
      const field = l.fields[index], offset = l.dataOffset + field.offset;
      const current = readField(sample, offset, field, p.byteOrder);
      const value = sampleValue(field, rules, current);
      if (field.type === "bit") sample[offset] = (sample[offset] & ~(1 << field.bitOffset)) | (value << field.bitOffset);
      else if (field.type === "float") view.setFloat32(offset, value, p.byteOrder === "little");
      else for (let i = 0; i < TYPES[field.type]; i++) sample[offset + i] = (value >>> (8 * (p.byteOrder === "little" ? i : TYPES[field.type] - 1 - i))) & 0xff;
    }
    const crc = calculateCrc(sample.subarray(p.crc.scope === "data" ? l.dataOffset : 0, l.crcOffset), crcParameters(p.crc));
    for (let i = 0; i < l.crcBytes; i++) sample[l.crcOffset + i] = (crc >>> (8 * (p.crc.byteOrder === "little" ? i : l.crcBytes - 1 - i))) & 0xff;
    return hex(sample);
  }
  function preview(config, text) {
    const errors = validate(config);
    if (errors.length) throw new Error(errors.join("；"));
    const p = config.protocol, l = layout(config);
    let sampleHex = "", sampleError = null;
    try { sampleHex = makeSample(config); } catch (error) { sampleError = error.message; if (text === "") throw error; }
    const data = bytes(text === "" ? sampleHex : text);
    const headers = headerValues(p).map((value) => bytes(value)), tail = bytes(p.tail), frames = [];
    let position = 0, rejected = 0, crcFailure = null, checkFailure = null;
    while (position + Math.max(1, l.headerBytes) <= data.length) {
      if (headers.length && !headers.some((header) => header.every((value, i) => data[position + i] === value))) { position++; continue; }
      const prefixFailure = checkFields(data.subarray(position), l, p);
      if (prefixFailure && prefixFailure !== "pending") { rejected++; checkFailure = prefixFailure; position++; continue; }
      let frameSize = l.frameBytes;
      if (p.kind === "delimited") {
        let end = position + l.headerBytes;
        while (end + tail.length <= data.length && end - position <= 65536 - tail.length && !tail.every((value, i) => data[end + i] === value)) end++;
        if (end - position > 65536 - tail.length) { rejected++; position++; continue; }
        if (end + tail.length > data.length) break;
        frameSize = end + tail.length - position;
      }
      if (position + frameSize > data.length) break;
      const frame = data.subarray(position, position + frameSize);
      const crcOffset = frameSize - l.tailBytes - l.crcBytes, dataBytes = crcOffset - l.dataOffset;
      const aligned = p.kind === "fixed" || !p.repeatWords ? frameSize === l.frameBytes : wordData(p) ? dataBytes >= 0 && dataBytes % 4 === 0 : dataBytes >= l.dataBytes && (dataBytes - l.dataBytes) % 4 === 0;
      const failure = checkFields(frame, l, p, true, crcOffset);
      const expected = aligned ? calculateCrc(frame.subarray(p.crc.scope === "data" ? l.dataOffset : 0, crcOffset), crcParameters(p.crc)) : 0;
      const actual = aligned && l.crcBytes ? readUnsigned(frame, crcOffset, l.crcBytes, p.crc.byteOrder) : 0;
      if (!aligned || failure || !tail.every((value, i) => frame[frameSize - tail.length + i] === value) || actual !== expected) {
        rejected++;
        if (failure) checkFailure = failure;
        if (actual !== expected) crcFailure = { actual, expected };
        position++; continue;
      }
      frames.push({ start: position, end: position + frameSize - 1, crc: actual, channels: decode(frame, l, p) });
      if (frames.length > 256) throw new Error("单次试解析最多支持 256 帧。");
      position += frameSize;
    }
    return { sampleHex, sampleError, frameBytes: p.kind === "fixed" ? l.frameBytes : null, inputBytes: data.length, consumedBytes: position, remainingBytes: data.length - position, rejected, crcFailure, checkFailure, frames };
  }
  function descriptions(config, displayName) {
    const p = config.protocol, l = layout(config);
    const mapping = l.channels.map((field, index) => `ch${index} ${field.name || `ch${index}`}: Byte ${l.dataOffset + field.offset}, ${field.type}${field.type === "bit" ? ` bit ${field.bitOffset}` : ""}`).join("\n");
    const crcName = crcParameters(p.crc)?.label || "Custom CRC";
    let example;
    try { example = makeSample(config); } catch (_error) { example = ""; }
    const warning = "uint32 / int32 → QVector<float>: integers above 24-bit precision may lose accuracy (16,777,216).";
    const url = "https://www.vofa.plus/docs/learning/dataengines/introduce";
    const descriptions = Object.fromEntries(["SimplifiedChinese", "TraditionalChinese", "English"].map((language) => [language, { format: "", example, url }]));
    const headerText = headerValues(p).map((value) => hex(bytes(value))).join(" / ") || "none";
    const checks = (p.checks || []).map((check) => (l.fields[check.field].name || "field " + check.field) + ": " + check.operator + " " + (check.values ? check.values.join(", ") : check.operator === "range" ? check.min + "…" + check.max : "0x" + check.mask.toString(16) + " = 0x" + check.value.toString(16))).join("; ");
    const details = {
      SimplifiedChinese: (p.kind === "fixed" ? "固定 " + l.frameBytes + " 字节" : "按帧尾结束" + (p.repeatWords ? "，后续每 4 字节追加 float32" : "，数据域按配置结构")) + "；帧头 " + (headerText === "none" ? "无" : headerText) + "；帧尾 " + (p.tail ? hex(bytes(p.tail)) : "无") + "；" + crcName + "，校验" + (p.crc.scope === "data" ? "数据域" : "帧头与数据域") + "；" + (p.byteOrder === "little" ? "小端" : "大端") + "。值校验失败从候选起点后移 1 字节重找，半帧保留等待。",
      TraditionalChinese: (p.kind === "fixed" ? "固定 " + l.frameBytes + " 位元組" : "按幀尾結束" + (p.repeatWords ? "，後續每 4 位元組追加 float32" : "，資料域按設定結構")) + "；幀頭 " + (headerText === "none" ? "無" : headerText) + "；幀尾 " + (p.tail ? hex(bytes(p.tail)) : "無") + "；" + crcName + "；" + p.crc.scope + "；" + p.byteOrder + "。值校驗失敗從候選起點後移 1 位元組重找，半幀保留等待。",
      English: (p.kind === "fixed" ? "Fixed " + l.frameBytes + "-byte frames" : "Tail-delimited frames" + (p.repeatWords ? "; subsequent 4-byte Words append float32 channels" : "; configured payload structure")) + "; header " + headerText + "; tail " + (p.tail ? hex(bytes(p.tail)) : "none") + "; " + crcName + " over " + p.crc.scope + "; " + p.byteOrder + "-endian. Reject a failed value check and retry one byte after the candidate start; retain incomplete frames."
    };
    for (const language of Object.keys(descriptions)) descriptions[language].format = (displayName || config.engineName || "") + ": " + details[language] + "\n" + mapping + (checks ? "\n" + checks : "") + "\n" + warning;
    return descriptions;
  }
  function previewJustFloat(config, text) {
    const compatible = { ...config, version: 3, protocol: { ...defaults(), kind: "delimited", header: "", tail: "0000807F", repeatWords: true, crc: { algorithm: "none", scope: "data", byteOrder: "little" } } };
    const l = layout(compatible), sampleHex = makeSample(compatible), data = bytes(text === "" ? sampleHex : text), frames = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let begin = 0, rejected = 0;
    for (let i = 3; i < data.length; i++) {
      if (view.getUint32(i - 3, true) !== 0x7f800000) continue;
      let end = i, imageSize = 0, image = null;
      if (i + 4 < data.length && view.getUint32(i + 1, true) === 0x7f800000) {
        i += 4;
        if (i - begin + 1 !== 28) break;
        imageSize = view.getInt32(i - 23, true);
        if (imageSize < 0 || i + imageSize >= data.length) break;
        image = { imageId: view.getInt32(i - 27, true), width: view.getInt32(i - 19, true), height: view.getInt32(i - 15, true), format: view.getInt32(i - 11, true) };
        end = i + imageSize; i = end;
      }
      if (image || (end - begin + 1) % 4 === 0) frames.push({ start: begin, end, crc: 0, imageSize, ...(image || {}), channels: image ? [] : decode(data.subarray(begin, end + 1), l, compatible.protocol) });
      else rejected++;
      begin = i + 1;
      if (frames.length > 256) throw new Error("单次试解析最多支持 256 帧。");
    }
    return { sampleHex, frameBytes: null, inputBytes: data.length, consumedBytes: begin, remainingBytes: data.length - begin, rejected, crcFailure: null, checkFailure: null, frames };
  }
  return Object.freeze({ TYPES, CRCS, defaults, normalize, validate, bytes, hex, fieldSize, layout, fields, outputs, headerValues, wordData, fieldBounds, matchesCheck, readField, crcParameters, calculateCrc, preview, previewJustFloat, makeSample, descriptions });
});
