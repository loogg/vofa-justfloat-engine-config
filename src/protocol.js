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
      dataFields: Array.isArray(value.dataFields) ? value.dataFields.map((field) => object(field) ? {
        type: field.type, name: field.name === undefined ? "" : field.name,
        ...(field.type === "word" ? { mappings: Array.isArray(field.mappings) ? field.mappings.map((mapping) => object(mapping) ? { type: mapping.type, name: mapping.name ?? "", bitOffset: mapping.bitOffset } : mapping) : field.mappings } : {}),
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
  function outputs(config) {
    const p = config.protocol;
    const list = [];
    if (p.dataMode === "custom") {
      let offset = 0;
      p.dataFields.forEach((field, index) => {
        if (field.type === "word") {
          if (!field.mappings.length) list.push({ type: "float", name: field.name || `Word ${index}`, offset, index, bitOffset: 0, width: 32 });
          else field.mappings.forEach((mapping) => list.push({ ...mapping, offset: offset + Math.floor(mapping.bitOffset / 8), index, bitOffset: mapping.bitOffset % 8, width: mapping.type === "bit" ? 1 : TYPES[mapping.type] * 8 }));
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
  function layout(config) {
    const p = config.protocol;
    const headerBytes = bytes(p.header, 64).length;
    const tailBytes = bytes(p.tail, 64).length;
    const dataBytes = p.dataMode === "words" ? config.wordCount * 4 : p.dataFields.reduce((sum, field) => sum + fieldSize(field), 0);
    const crcBytes = (crcParameters(p.crc)?.width || 0) / 8;
    return { headerBytes, dataBytes, crcBytes, tailBytes, frameBytes: headerBytes + dataBytes + crcBytes + tailBytes, channels: outputs(config), dataOffset: headerBytes, crcOffset: headerBytes + dataBytes, tailOffset: headerBytes + dataBytes + crcBytes };
  }
  function validate(config) {
    const errors = [];
    const p = config.protocol;
    if (!object(p)) return ["protocol 必须是对象。"];
    if (config.version !== 3) errors.push("固定结构协议使用配置 version: 3。");
    if (p.kind !== "fixed") errors.push("当前仅支持 fixed 固定结构协议。");
    if (!["words", "custom"].includes(p.dataMode)) errors.push("数据域模式必须是 words 或 custom。");
    if (!["little", "big"].includes(p.byteOrder)) errors.push("数据字节序必须是 little 或 big。");
    for (const [key, title] of [["header", "帧头"], ["tail", "帧尾"]]) {
      try { if (key === "header" && !bytes(p[key], 64).length) errors.push("请添加至少 1 字节的帧头。"); else bytes(p[key], 64); } catch (error) { errors.push(`${title}：${error.message}`); }
    }
    if (!Array.isArray(p.dataFields)) errors.push("dataFields 必须是数组。");
    else if (p.dataMode === "custom") {
      if (!p.dataFields.length || p.dataFields.length > 256) errors.push("自定义数据域需要 1–256 个字段积木。");
      p.dataFields.forEach((field, index) => {
        if (!object(field)) { errors.push(`字段 ${index + 1} 格式无效。`); return; }
        if (!Object.hasOwn(TYPES, field.type) && !["reserved", "word"].includes(field.type)) errors.push(`字段 ${index + 1} 的类型不受支持。`);
        if (typeof field.name !== "string" || field.name.length > 48) errors.push(`字段 ${index + 1} 的名称需为不超过 48 字符的文本。`);
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
  function decode(data, l, p) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return l.channels.map((field, channel) => {
      const offset = l.dataOffset + field.offset;
      let value;
      if (field.type === "bit") value = (data[offset] >>> field.bitOffset) & 1;
      else if (field.type === "float") value = view.getFloat32(offset, p.byteOrder === "little");
      else {
        value = readUnsigned(data, offset, TYPES[field.type], p.byteOrder);
        if (field.type.startsWith("int") && value >= Math.pow(2, field.width - 1)) value -= Math.pow(2, field.width);
      }
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
    const crc = calculateCrc(sample.subarray(p.crc.scope === "data" ? l.dataOffset : 0, l.crcOffset), crcParameters(p.crc));
    for (let i = 0; i < l.crcBytes; i++) sample[l.crcOffset + i] = (crc >>> (8 * (p.crc.byteOrder === "little" ? i : l.crcBytes - 1 - i))) & 0xff;
    return hex(sample);
  }
  function preview(config, text) {
    const errors = validate(config);
    if (errors.length) throw new Error(errors.join("；"));
    const p = config.protocol, l = layout(config), sampleHex = makeSample(config);
    const data = bytes(text === "" ? sampleHex : text);
    const header = bytes(p.header), tail = bytes(p.tail), frames = [];
    let position = 0, rejected = 0, crcFailure = null;
    while (position + header.length <= data.length) {
      if (!header.every((value, i) => data[position + i] === value)) { position++; continue; }
      if (position + l.frameBytes > data.length) break;
      const frame = data.subarray(position, position + l.frameBytes);
      const expected = calculateCrc(frame.subarray(p.crc.scope === "data" ? l.dataOffset : 0, l.crcOffset), crcParameters(p.crc));
      const actual = l.crcBytes ? readUnsigned(frame, l.crcOffset, l.crcBytes, p.crc.byteOrder) : 0;
      if (!tail.every((value, i) => frame[l.tailOffset + i] === value) || actual !== expected) {
        rejected++;
        if (actual !== expected) crcFailure = { actual, expected };
        position++; continue;
      }
      frames.push({ start: position, end: position + l.frameBytes - 1, crc: actual, channels: decode(frame, l, p) });
      if (frames.length > 256) throw new Error("单次试解析最多支持 256 帧。");
      position += l.frameBytes;
    }
    return { sampleHex, frameBytes: l.frameBytes, inputBytes: data.length, consumedBytes: position, remainingBytes: data.length - position, rejected, crcFailure, frames };
  }
  function descriptions(config, displayName) {
    const p = config.protocol, l = layout(config);
    const mapping = l.channels.map((field, index) => `ch${index} ${field.name || `ch${index}`}: Byte ${l.dataOffset + field.offset}, ${field.type}${field.type === "bit" ? ` bit ${field.bitOffset}` : ""}`).join("\n");
    const crcName = crcParameters(p.crc)?.label || "Custom CRC";
    const example = makeSample(config);
    const warning = "uint32 / int32 → QVector<float>: integers above 24-bit precision may lose accuracy (16,777,216).";
    const url = "https://www.vofa.plus/docs/learning/dataengines/introduce";
    return {
      SimplifiedChinese: { format: `${displayName}：固定 ${l.frameBytes} 字节。帧头 ${hex(bytes(p.header))}；数据域 ${l.dataBytes} 字节，${p.byteOrder === "little" ? "小端" : "大端"}；${crcName}，校验${p.crc.scope === "data" ? "数据域" : "帧头与数据域"}；帧尾 ${p.tail ? hex(bytes(p.tail)) : "无"}。字段值不改变帧长。\n${mapping}\n${warning}`, example, url },
      TraditionalChinese: { format: `${displayName}：固定 ${l.frameBytes} 位元組。幀頭 ${hex(bytes(p.header))}；資料域 ${l.dataBytes} 位元組，${p.byteOrder === "little" ? "小端" : "大端"}；${crcName}，校驗${p.crc.scope === "data" ? "資料域" : "幀頭與資料域"}；幀尾 ${p.tail ? hex(bytes(p.tail)) : "無"}。欄位值不改變幀長。\n${mapping}\n${warning}`, example, url },
      English: { format: `${displayName}: fixed ${l.frameBytes}-byte frames. Header ${hex(bytes(p.header))}; ${l.dataBytes}-byte ${p.byteOrder}-endian payload; ${crcName} over ${p.crc.scope}; tail ${p.tail ? hex(bytes(p.tail)) : "none"}. Field values never change frame length.\n${mapping}\n${warning}`, example, url }
    };
  }
  return Object.freeze({ TYPES, CRCS, defaults, normalize, validate, bytes, hex, fieldSize, layout, outputs, crcParameters, calculateCrc, preview, makeSample, descriptions });
});
