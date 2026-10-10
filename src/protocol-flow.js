(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol'));
  else root.ProtocolFlow = factory(root.ProtocolModel);
})(typeof globalThis === 'object' ? globalThis : this, function (model) {
  'use strict';
  const TYPES = ['vofa-receive', 'vofa-check', 'vofa-header', 'vofa-crc', 'vofa-tail', 'vofa-output', 'vofa-justfloat', 'vofa-word', ...Object.keys(model.TYPES).map((type) => `vofa-${type}`), 'vofa-reserved'];
  const ROOT = 'vofa-protocol';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value);
  function normalize(scene) {
    if (!plain(scene) || ![1, 2, 3].includes(scene.version) || !Array.isArray(scene.flows) || scene.flows.length > 1024) throw new Error('Node-RED 画布配置无效，最多支持 1024 个对象。');
    const copy = clone(scene);
    const ids = new Set();
    for (const entry of copy.flows) {
      if (!plain(entry) || !validId(entry.id) || ids.has(entry.id)) throw new Error('画布节点 ID 无效或重复。');
      ids.add(entry.id);
      if (!['tab', 'subflow', 'group', 'junction', ...TYPES].includes(entry.type) && !/^subflow:[A-Za-z0-9_.-]{1,80}$/.test(entry.type || '')) throw new Error(`不支持节点类型：${entry.type}。仅允许协议节点。`);
      if (entry.z !== undefined && !validId(entry.z)) throw new Error('节点所属画布 ID 无效。');
      for (const key of ['x', 'y', 'w', 'h']) if (entry[key] !== undefined && (!Number.isFinite(entry[key]) || Math.abs(entry[key]) > 100000)) throw new Error('节点坐标或尺寸超出范围。');
      if (entry.wires !== undefined && (!Array.isArray(entry.wires) || entry.wires.length > 1 || entry.wires.some((ports) => !Array.isArray(ports) || ports.length > 1024 || ports.some((id) => !validId(id))))) throw new Error('协议节点的连线格式无效。');
      if (entry.mappings !== undefined && (!Array.isArray(entry.mappings) || entry.mappings.length > 32 || entry.mappings.some((field) => !plain(field)))) throw new Error('Word 位映射格式无效。');
      if (entry.mappings) {
        const references = entry.mappings.map((field) => field._refId).filter((value) => value !== undefined);
        if (references.some((value) => !validId(value)) || new Set(references).size !== references.length) throw new Error('Word 字段引用无效或重复，请重新保存位映射。');
      }
    }
    if (JSON.stringify(copy).length > 800000) throw new Error('画布配置过大。');
    if (scene.version === 2 && (!['fixed', 'justfloat'].includes(scene.kind) || !['little', 'big'].includes(scene.byteOrder))) throw new Error('画布协议类型或数据字节序无效。');
    if (scene.version === 3 && !['little', 'big'].includes(scene.byteOrder)) throw new Error('数据字节序无效。');
    return scene.version === 1 ? { version: 1, flows: copy.flows } : scene.version === 2 ? { version: 2, kind: scene.kind, byteOrder: scene.byteOrder, flows: copy.flows } : { version: 3, byteOrder: scene.byteOrder, flows: copy.flows };
  }
  function seedLegacy(config) {
    const fixed = Boolean(config.protocol), p = config.protocol || model.defaults();
    const dataMode = fixed ? p.dataMode : 'words';
    const flows = [{ id: ROOT, type: 'tab', label: config.engineName || '协议结构', disabled: false, info: '节点连线决定协议结构。双击数据域，编辑内部字段。' }];
    for (const mode of ['words', 'custom']) {
      const id = `vofa-data-${mode}`;
      const active = dataMode === mode;
      const fields = active && mode === 'custom' ? p.dataFields : [{ type: 'float', name: 'ch0' }, { type: 'float', name: 'ch1' }];
      const count = mode === 'words' ? (active ? config.wordCount : 2) : fields.length;
      const childIds = Array.from({ length: count }, (_, index) => `${mode}-${index}`);
      flows.push({ id, type: 'subflow', name: mode === 'words' ? '4 字节 Word 数据域' : '自定义数据域', category: '数据域', color: '#C0DEED',
        info: mode === 'words' ? '内部只放置 4 字节 Word。连线决定 Word 顺序，双击 Word 配置位映射。' : '内部放置定宽字段。连线决定字段顺序，保留字节需要显式添加。',
        meta: { vofaMode: mode }, env: [{ name: 'byteOrder', type: 'str', value: fixed ? p.byteOrder : 'little',
          ui: { type: 'select', label: { 'zh-CN': '数据字节序', 'en-US': 'Byte order' }, opts: { opts: [{ v: 'little', l: { 'zh-CN': '小端', 'en-US': 'Little endian' } }, { v: 'big', l: { 'zh-CN': '大端', 'en-US': 'Big endian' } }] } } }],
        in: [{ x: 70, y: 160, wires: count ? [{ id: childIds[0] }] : [] }],
        out: [{ x: Math.max(480, 180 + count * 170), y: 160, wires: count ? [{ id: childIds[count - 1], port: 0 }] : [] }] });
      for (let index = 0; index < count; index++) {
        const entry = { id: childIds[index], z: id, x: 190 + index * 170, y: 160, wires: [index + 1 < count ? [childIds[index + 1]] : []] };
        if (mode === 'words') {
          Object.assign(entry, { type: 'vofa-word', name: `Word ${index}`, mappings: active ? config.fields.filter((field) => field.wordIndex === index).map(({ type, bitOffset, name }) => ({ type, bitOffset, name })) : [] });
        } else Object.assign(entry, { type: `vofa-${fields[index].type}`, name: fields[index].name || '', bytes: fields[index].bytes || 1, bitOffset: fields[index].bitOffset || 0 });
        flows.push(entry);
      }
    }
    const data = { id: 'data', type: `subflow:vofa-data-${dataMode}`, name: '', z: ROOT, x: 390, y: 160, wires: [['crc']], env: [{ name: 'byteOrder', type: 'str', value: p.byteOrder }] };
    if (fixed) {
      flows.push({ id: 'header', type: 'vofa-header', z: ROOT, x: 160, y: 160, name: '', hex: p.header, wires: [['data']] }, data);
      const chain = ['data'];
      if (p.crc.algorithm !== 'none') {
        const params = model.crcParameters(p.crc);
        flows.push({ id: 'crc', type: 'vofa-crc', name: '', z: ROOT, x: 620, y: 160, wires: [[]], algorithm: p.crc.algorithm, scope: p.crc.scope, byteOrder: p.crc.byteOrder,
          width: params.width, polynomial: params.polynomial.toString(16), init: params.init.toString(16), xorOut: params.xorOut.toString(16), reflectInput: params.reflectInput, reflectOutput: params.reflectOutput });
        chain.push('crc');
      }
      if (p.tail) { flows.push({ id: 'tail', type: 'vofa-tail', name: '', z: ROOT, x: 840, y: 160, wires: [[]], hex: p.tail }); chain.push('tail'); }
      chain.push('output');
      chain.slice(0, -1).forEach((id, index) => { flows.find((node) => node.id === id).wires = [[chain[index + 1]]]; });
      flows.push({ id: 'output', type: 'vofa-output', z: ROOT, name: '', x: p.tail ? 1040 : p.crc.algorithm !== 'none' ? 850 : 620, y: 160, wires: [] });
    } else {
      flows.push({ id: 'justfloat', type: 'vofa-justfloat', z: ROOT, x: 280, y: 160, name: '', dataRef: 'vofa-data-words', wires: [['output']] },
        { id: 'output', type: 'vofa-output', z: ROOT, x: 550, y: 160, name: '', wires: [] });
    }
    return { version: 1, flows };
  }
  function compileLegacy(input) {
    let scene;
    try { scene = normalize(input); } catch (error) { return { valid: false, errors: [error.message], config: null }; }
    const all = new Map(scene.flows.map((node) => [node.id, node]));
    const errors = [];
    const fail = (message) => { throw new Error(message); };
    function walk(start, scope, terminal, reverse = false) {
      const order = [], seen = new Set();
      let current = start;
      while (current) {
        if (seen.has(current)) fail('协议连线存在循环，请移除回路。');
        seen.add(current);
        const node = all.get(current);
        if (!node || node.z !== scope) fail('连线指向了不存在或不同画布的节点。');
        if (node.type !== 'junction') order.push(node);
        if (terminal?.(node)) return order;
        let next;
        if (reverse) {
          const incoming = scene.flows.filter((other) => other.z === scope && (other.wires?.[0] || []).includes(node.id));
          if (incoming.length !== 1) fail('请将协议节点连接成一条连续链，每个节点只接收一条连线。');
          next = incoming[0].id;
        } else {
          const outgoing = node.wires?.[0] || [];
          if (!outgoing.length) {
            if (terminal) fail('数据域连线尚未到达输出端口。');
            return order;
          }
          if (outgoing.length !== 1) fail('数据域目前只支持顺序字段，请移除分支连线。');
          next = outgoing[0];
        }
        current = next;
      }
      return order;
    }
    function dataLayout(definitionId, instance) {
      const def = all.get(definitionId);
      if (!def || def.type !== 'subflow' || !['words', 'custom'].includes(def.meta?.vofaMode)) fail('请使用 Word 或自定义数据域积木。');
      if (def.in?.length !== 1 || def.out?.length !== 1 || def.in[0].wires?.length !== 1 || def.out[0].wires?.length !== 1) fail('请将数据域输入、字段和输出连接成一条完整的链。');
      const first = def.in[0].wires[0].id, last = def.out[0].wires[0].id;
      const ordered = walk(first, definitionId, (node) => node.id === last);
      if (!ordered.length) fail('数据域至少需要一个 Word 或字段。');
      if ((all.get(last).wires?.[0] || []).length) fail('数据域输出前的节点不能再连接其他字段。');
      if (ordered.length > 256) fail('数据域最多支持 256 个 Word 或字段。');
      const env = [...(instance?.env || []), ...(def.env || [])].find((value) => value.name === 'byteOrder');
      const byteOrder = env?.value || 'little';
      if (!['little', 'big'].includes(byteOrder) || env && env.type !== 'str') fail('数据字节序需为 little 或 big 字符串。');
      if (def.meta.vofaMode === 'words') {
        if (ordered.some((node) => node.type !== 'vofa-word')) fail('Word 数据域内部只允许 4 字节 Word 积木。');
        return { mode: 'words', byteOrder, wordCount: ordered.length, fields: ordered.flatMap((node, wordIndex) => (node.mappings || []).map((field) => ({ wordIndex, type: field.type, bitOffset: field.bitOffset, name: field.name || '' }))) };
      }
      const fields = ordered.map((node) => {
        const type = node.type.replace(/^vofa-/, '');
        if (!Object.hasOwn(model.TYPES, type) && type !== 'reserved') fail('自定义数据域内只允许定宽字段和保留字节。');
        return { type, name: node.name || '', ...(type === 'reserved' ? { bytes: Number(node.bytes) } : {}), ...(type === 'bit' ? { bitOffset: Number(node.bitOffset) } : {}) };
      });
      return { mode: 'custom', byteOrder, fields };
    }
    try {
      const tabs = scene.flows.filter((node) => node.type === 'tab');
      if (tabs.length !== 1) fail('一份引擎配置需要且只能有一条协议主流程。');
      const rootId = tabs[0].id;
      const outputs = scene.flows.filter((node) => node.type === 'vofa-output' && node.z === rootId);
      if (outputs.length !== 1) fail('请在主流程保留一个 VOFA+ 输出节点。');
      const chain = walk(outputs[0].id, rootId, (node) => ['vofa-header', 'vofa-justfloat'].includes(node.type), true).reverse();
      for (const node of chain.slice(0, -1)) if ((node.wires?.[0] || []).length !== 1) fail('主流程目前只支持一条采样帧链，请移除分支。');
      if (chain[0].type === 'vofa-justfloat') {
        if (chain.length !== 2) fail('JustFloat 是完整协议积木，直接连接 VOFA+ 输出。');
        const layout = dataLayout(chain[0].dataRef);
        if (layout.mode !== 'words' || layout.byteOrder !== 'little') fail('JustFloat 数据域使用小端 4 字节 Word。');
        return { valid: true, errors: [], config: { version: 2, wordCount: layout.wordCount, fields: layout.fields.length ? layout.fields : Array.from({ length: layout.wordCount }, (_, wordIndex) => ({ wordIndex, type: 'float', bitOffset: 0, name: `ch${wordIndex}` })) } };
      }
      if (chain[0].type !== 'vofa-header' || !/^subflow:/.test(chain[1]?.type || '')) fail('主流程需按 帧头 → 数据域 → 可选校验/帧尾 → VOFA+ 输出 连接。');
      const layout = dataLayout(chain[1].type.slice(8), chain[1]);
      const rest = chain.slice(2, -1);
      if (rest.length > 2 || rest.some((node) => !['vofa-crc', 'vofa-tail'].includes(node.type)) || rest.filter((node) => node.type === 'vofa-crc').length > 1 || rest.filter((node) => node.type === 'vofa-tail').length > 1 || rest.length === 2 && rest[0].type !== 'vofa-crc') fail('校验在数据域之后，帧尾在校验之后；每类只能连接一个。');
      const crc = rest.find((node) => node.type === 'vofa-crc'), tail = rest.find((node) => node.type === 'vofa-tail');
      const p = model.defaults(layout.mode);
      p.header = chain[0].hex; p.tail = tail?.hex || ''; p.byteOrder = layout.byteOrder;
      p.dataFields = layout.mode === 'custom' ? layout.fields : [];
      p.crc = crc ? { algorithm: crc.algorithm, scope: crc.scope, byteOrder: crc.byteOrder } : { algorithm: 'none', scope: 'data', byteOrder: 'little' };
      if (crc?.algorithm === 'custom') {
        const number = (value) => typeof value === 'string' && /^[a-f0-9]{1,8}$/i.test(value) ? parseInt(value, 16) : -1;
        p.crc.parameters = { width: Number(crc.width), polynomial: number(crc.polynomial), init: number(crc.init), xorOut: number(crc.xorOut), reflectInput: crc.reflectInput, reflectOutput: crc.reflectOutput };
      }
      const config = { version: 3, wordCount: layout.mode === 'words' ? layout.wordCount : 1, fields: layout.mode === 'words' ? layout.fields : [], protocol: model.normalize(p) };
      errors.push(...model.validate(config));
      return { valid: !errors.length, errors, config };
    } catch (error) { return { valid: false, errors: [error.message], config: null }; }
  }
  function seedV2(config) {
    const fixed = Boolean(config.protocol), p = config.protocol || model.defaults();
    const flows = [{ id: ROOT, type: 'tab', label: config.engineName || '协议结构', disabled: false, info: '在同一画布按字节顺序连接帧头、数据字段、CRC 和输出。双击 Word 编辑其内部位映射。' }];
    const parts = [{ id: fixed ? 'header' : 'justfloat', type: fixed ? 'vofa-header' : 'vofa-justfloat', name: '', ...(fixed ? { hex: p.header } : {}) }];
    if (!fixed || p.dataMode === 'words') {
      for (let index = 0; index < config.wordCount; index++) parts.push({ id: `words-${index}`, type: 'vofa-word', name: `Word ${index}`, mappings: config.fields.filter((field) => field.wordIndex === index).map(({ type, name, bitOffset, output }) => ({ type, name, bitOffset, ...(output !== undefined ? { output } : {}) })) });
    } else {
      p.dataFields.forEach((field, index) => parts.push({ id: `field-${index}`, type: field.type === 'word' ? 'vofa-word' : `vofa-${field.type}`, name: field.name || '', ...(field.output !== undefined ? { output: field.output } : {}), ...(field.type === 'word' ? { mappings: field.mappings } : {}), ...(field.type === 'reserved' ? { bytes: field.bytes } : {}), ...(field.type === 'bit' ? { bitOffset: field.bitOffset } : {}) }));
    }
    if (fixed && p.crc.algorithm !== 'none') {
      const params = model.crcParameters(p.crc);
      parts.push({ id: 'crc', type: 'vofa-crc', name: '', algorithm: p.crc.algorithm, scope: p.crc.scope, byteOrder: p.crc.byteOrder, width: params.width, polynomial: params.polynomial.toString(16), init: params.init.toString(16), xorOut: params.xorOut.toString(16), reflectInput: params.reflectInput, reflectOutput: params.reflectOutput });
    }
    if (fixed && p.tail) parts.push({ id: 'tail', type: 'vofa-tail', name: '', hex: p.tail });
    parts.push({ id: 'output', type: 'vofa-output', name: '' });
    parts.forEach((node, index) => flows.push({ ...node, z: ROOT, x: 140 + index * 180, y: 160, wires: index + 1 < parts.length ? [[parts[index + 1].id]] : [] }));
    return { version: 2, kind: fixed ? 'fixed' : 'justfloat', byteOrder: fixed ? p.byteOrder : 'little', flows };
  }
  function compileV2(input) {
    if (input?.version === 1) return compileLegacy(input);
    try {
      const scene = normalize(input), tabs = scene.flows.filter((node) => node.type === 'tab');
      const fail = (message) => { throw new Error(message); };
      if (tabs.length !== 1) fail('一份引擎配置需要且只能有一条协议主流程。');
      const root = tabs[0].id, nodes = scene.flows.filter((node) => node.z === root), byId = new Map(nodes.map((node) => [node.id, node]));
      const outputs = nodes.filter((node) => node.type === 'vofa-output');
      if (outputs.length !== 1) fail('请在主流程保留一个 VOFA+ 输出节点。');
      const chain = [], seen = new Set();
      let current = outputs[0];
      while (current) {
        if (seen.has(current.id)) fail('协议连线存在循环，请移除回路。');
        seen.add(current.id);
        if (current.type !== 'junction') chain.unshift(current);
        if (['vofa-header', 'vofa-justfloat'].includes(current.type)) break;
        const incoming = nodes.filter((node) => (node.wires?.[0] || []).includes(current.id));
        if (incoming.length !== 1) fail('请将协议节点连接成一条连续链，每个节点只接收一条连线。');
        current = incoming[0];
      }
      for (const id of seen) if (id !== outputs[0].id && (byId.get(id).wires?.[0] || []).length !== 1) fail('采样帧链不支持分支，请移除多余连线。');
      if (chain[0].type !== (scene.kind === 'fixed' ? 'vofa-header' : 'vofa-justfloat')) fail('起始节点与所选协议预设不一致。');
      const data = chain.slice(1, -1);
      let tail, crc;
      if (data.at(-1)?.type === 'vofa-tail') tail = data.pop();
      if (data.at(-1)?.type === 'vofa-crc') crc = data.pop();
      if (!data.length || data.length > 256) fail('数据域需要 1–256 个 Word 或定宽字段。');
      const wordFields = data.flatMap((node, wordIndex) => (node.mappings || []).map((field) => ({ wordIndex, type: field.type, bitOffset: field.bitOffset, name: field.name || '' })));
      const wordsOnly = data.every((node) => node.type === 'vofa-word');
      if (data.some((node) => node.output !== undefined && typeof node.output !== 'boolean' || node.mappings?.some((field) => field.output !== undefined && typeof field.output !== 'boolean'))) fail('字段输出选项必须是布尔值。');
      if (scene.kind === 'justfloat') {
        if (!wordsOnly || crc || tail || scene.byteOrder !== 'little') fail('JustFloat 数据链仅使用小端 4 字节 Word，保留其原有收帧规则。');
        return { valid: true, errors: [], config: { version: 2, wordCount: data.length, fields: wordFields.length ? wordFields : data.map((_node, wordIndex) => ({ wordIndex, type: 'float', bitOffset: 0, name: `ch${wordIndex}` })) } };
      }
      const p = model.defaults(wordsOnly ? 'words' : 'custom');
      p.header = chain[0].hex; p.tail = tail?.hex || ''; p.byteOrder = scene.byteOrder;
      if (!wordsOnly) p.dataFields = data.map((node) => {
        const type = node.type === 'vofa-word' ? 'word' : node.type.replace(/^vofa-/, '');
        if (!Object.hasOwn(model.TYPES, type) && !['word', 'reserved'].includes(type)) fail('帧头和校验之间只允许 Word、定宽字段和保留字节。');
        return { type, name: node.name || '', ...(type === 'word' ? { mappings: node.mappings || [] } : {}), ...(type === 'reserved' ? { bytes: Number(node.bytes) } : {}), ...(type === 'bit' ? { bitOffset: Number(node.bitOffset) } : {}) };
      });
      p.crc = crc ? { algorithm: crc.algorithm, scope: crc.scope, byteOrder: crc.byteOrder } : { algorithm: 'none', scope: 'data', byteOrder: 'little' };
      if (crc?.algorithm === 'custom') {
        const number = (value) => typeof value === 'string' && /^[a-f0-9]{1,8}$/i.test(value) ? parseInt(value, 16) : -1;
        p.crc.parameters = { width: Number(crc.width), polynomial: number(crc.polynomial), init: number(crc.init), xorOut: number(crc.xorOut), reflectInput: crc.reflectInput, reflectOutput: crc.reflectOutput };
      }
      const config = { version: 3, wordCount: wordsOnly ? data.length : 1, fields: wordsOnly ? wordFields : [], protocol: model.normalize(p) }, errors = model.validate(config);
      return { valid: !errors.length, errors, config };
    } catch (error) { return { valid: false, errors: [error.message], config: null }; }
  }
  function nodeSources(node) {
    if (node.type === 'vofa-word') return (node.mappings?.length ? node.mappings.map((field, index) => ({ source: node.id + '#' + (field._refId ?? index), label: (node.name || 'Word') + ' / ' + (field.name || '字段 ' + (index + 1)) + ' · ' + field.type })) : [{ source: node.id, label: (node.name || 'Word') + ' · float32' }]);
    const type = node.type.replace(/^vofa-/, '');
    return Object.hasOwn(model.TYPES, type) ? [{ source: node.id, label: (node.name || type) + ' · ' + type }] : [];
  }
  function checkSources(scene, id) {
    const nodes = scene.flows.filter((node) => node.z === scene.flows.find((entry) => entry.id === id)?.z);
    const ordered = [], seen = new Set([id]);
    let current = id;
    for (;;) {
      const incoming = nodes.filter((node) => (node.wires?.[0] || []).includes(current));
      if (incoming.length !== 1 || seen.has(incoming[0].id)) break;
      const node = incoming[0]; seen.add(node.id); ordered.unshift(node); current = node.id;
    }
    return ordered.flatMap(nodeSources);
  }
  function seed(config) {
    const old = seedV2(config), p = config.protocol, flows = old.flows;
    const receive = { id: 'receive', type: 'vofa-receive', z: ROOT, name: '', x: 130, y: 160, framing: !p || p.kind === 'delimited' ? 'delimited' : 'fixed', repeat: !p || p.repeatWords === true, images: !p, wires: [[]] };
    const parts = flows.filter((node) => node.z === ROOT && node.type !== 'vofa-justfloat' && (node.type !== 'vofa-header' || p?.header));
    for (const node of parts.filter((node) => node.type === 'vofa-word')) node.mappings = node.mappings.map((field, index) => ({ ...field, _refId: field._refId ?? String(index) }));
    if (!p) parts.splice(parts.length - 1, 0, { id: 'tail', type: 'vofa-tail', z: ROOT, name: '', hex: '0000807F', wires: [[]] });
    if (p?.headerValues) parts.find((node) => node.type === 'vofa-header').hex = p.headerValues.join('\n');
    const allFields = p ? model.fields(config) : [];
    for (let index = (p?.checks?.length || 0) - 1; index >= 0; index--) {
      const check = p.checks[index], field = allFields[check.field];
      const node = parts.find((entry) => entry.id === (p.dataMode === 'words' ? 'words-' + field.wordIndex : 'field-' + field.index));
      const start = p.dataMode === 'words' ? field.wordIndex * 4 : p.dataFields.slice(0, field.index).reduce((sum, entry) => sum + model.fieldSize(entry), 0);
      const sources = nodeSources(node), source = sources[node.type === 'vofa-word' && node.mappings?.length ? node.mappings.findIndex((mapping) => mapping.bitOffset === (field.offset - start) * 8 + field.bitOffset) : 0]?.source;
      parts.splice(parts.indexOf(node) + 1, 0, { id: 'check-' + index, type: 'vofa-check', z: ROOT, name: '', source, operator: check.operator, values: (check.values || []).join(', '), min: check.min ?? 0, max: check.max ?? 0, mask: check.mask ?? '0xFF', value: check.value ?? 0, wires: [[]] });
    }
    const chain = [receive, ...parts];
    chain.forEach((node, index) => { node.x = 130 + index * 180; node.y = 160; node.wires = index + 1 < chain.length ? [[chain[index + 1].id]] : []; });
    return { version: 3, byteOrder: old.byteOrder, flows: [flows[0], ...chain] };
  }
  function empty(engineName) {
    return { version: 3, byteOrder: 'little', flows: [
      { id: ROOT, type: 'tab', label: engineName || '协议结构', disabled: false, info: '在接收流和输出之间插入协议模块。' },
      { id: 'receive', type: 'vofa-receive', z: ROOT, name: '', x: 150, y: 160, framing: 'fixed', repeat: true, images: false, wires: [['output']] },
      { id: 'output', type: 'vofa-output', z: ROOT, name: '', x: 750, y: 160, wires: [] }
    ] };
  }
  function compile(input) {
    if (input?.version !== 3) return compileV2(input);
    try {
      const scene = normalize(input), fail = (message) => { throw new Error(message); };
      const tabs = scene.flows.filter((node) => node.type === 'tab');
      if (tabs.length !== 1) fail('一份引擎配置需要且只能有一条协议主流程。');
      const nodes = scene.flows.filter((node) => node.z === tabs[0].id), outputs = nodes.filter((node) => node.type === 'vofa-output');
      if (outputs.length !== 1) fail('请在主流程保留一个 VOFA+ 输出节点。');
      const ordered = [], seen = new Set();
      let current = outputs[0];
      while (current) {
        if (seen.has(current.id)) fail('协议连线存在循环，请移除回路。');
        seen.add(current.id);
        if (current.type !== 'junction') ordered.unshift(current);
        if (current.type === 'vofa-receive') {
          if (nodes.some((node) => (node.wires?.[0] || []).includes(current.id))) fail('接收流节点不能有输入连线。');
          break;
        }
        const incoming = nodes.filter((node) => (node.wires?.[0] || []).includes(current.id));
        if (incoming.length !== 1) fail('请将接收流、协议字段和输出连接成一条连续链。');
        current = incoming[0];
      }
      for (const id of seen) if (id !== outputs[0].id && nodes.find((node) => node.id === id).wires?.[0]?.length !== 1) fail('第一阶段仅支持顺序校验，请移除分支连线。');
      const receive = ordered.shift(); ordered.pop();
      if (receive?.type !== 'vofa-receive' || !['fixed', 'delimited'].includes(receive.framing)) fail('请从接收流节点开始，并选择收帧规则。');
      if (typeof receive.repeat !== 'boolean' || typeof receive.images !== 'boolean') fail('接收流选项必须是布尔值。');
      const header = ordered[0]?.type === 'vofa-header' ? ordered.shift() : null;
      const tail = ordered.at(-1)?.type === 'vofa-tail' ? ordered.pop() : null;
      const crc = ordered.at(-1)?.type === 'vofa-crc' ? ordered.pop() : null;
      const data = ordered.filter((node) => node.type !== 'vofa-check');
      if (!data.length || data.length > 256) fail('数据域需要 1–256 个 Word 或定宽字段。');
      const wordsOnly = data.every((node) => node.type === 'vofa-word');
      const muted = data.some((node) => node.output === false || node.mappings?.some((field) => field.output === false));
      if (data.some((node) => node.output !== undefined && typeof node.output !== 'boolean' || node.mappings?.some((field) => field.output !== undefined && typeof field.output !== 'boolean'))) fail('字段输出选项必须是布尔值。');
      for (const node of data.filter((node) => node.type === 'vofa-word')) {
        node.mappings = (node.mappings || []).map((field, index) => ({ ...field, _refId: field._refId ?? String(index) }));
        // Word mode emits fields in physical bit order; checks must use that
        // same order while keeping the editor's stable field references.
        if (wordsOnly && !muted) node.mappings.sort((a, b) => a.bitOffset - b.bitOffset);
      }
      const wordFields = data.flatMap((node, wordIndex) => (node.mappings || []).map(({ _refId, ...field }) => ({ wordIndex, ...field, name: field.name || '' })));
      if (receive.images) {
        if (receive.framing !== 'delimited' || !receive.repeat || header || crc || !wordsOnly || muted || ordered.some((node) => node.type === 'vofa-check') || scene.byteOrder !== 'little' || model.hex(model.bytes(tail?.hex || '')) !== '00 00 80 7F') fail('图片兼容需使用无帧头、小端 Word、后续 Word 和 00 00 80 7F 帧尾。添加值校验或其他字段时，请在接收流中关闭图片兼容。');
        return { valid: true, errors: [], config: { version: 2, wordCount: data.length, fields: wordFields.length ? wordFields : data.map((_node, wordIndex) => ({ wordIndex, type: 'float', bitOffset: 0, name: 'ch' + wordIndex })) } };
      }
      const p = model.defaults(wordsOnly && !muted ? 'words' : 'custom');
      p.kind = receive.framing; p.byteOrder = scene.byteOrder; p.tail = tail?.hex || '';
      const headers = header ? header.hex.split(/[\n;,]+/).map((value) => value.trim().replace(/\s/g, '').toUpperCase()).filter(Boolean) : [];
      if (header && !headers.length) fail('帧头节点至少需要一个候选值；无帧头协议请省略该节点。');
      p.header = headers[0] || ''; if (headers.length > 1) p.headerValues = headers;
      if (p.kind === 'delimited') p.repeatWords = receive.repeat;
      if (p.dataMode === 'custom') p.dataFields = data.map((node) => {
        const type = node.type === 'vofa-word' ? 'word' : node.type.replace(/^vofa-/, '');
        if (!Object.hasOwn(model.TYPES, type) && !['word', 'reserved'].includes(type)) fail('数据域只允许字段、Word、保留字节和值校验。');
        return { type, name: node.name || '', ...(node.output === false ? { output: false } : {}), ...(type === 'word' ? { mappings: node.mappings || [] } : {}), ...(type === 'reserved' ? { bytes: Number(node.bytes) } : {}), ...(type === 'bit' ? { bitOffset: Number(node.bitOffset) } : {}) };
      });
      p.crc = crc ? { algorithm: crc.algorithm, scope: crc.scope, byteOrder: crc.byteOrder } : { algorithm: 'none', scope: 'data', byteOrder: 'little' };
      if (crc?.algorithm === 'custom') {
        const number = (value) => typeof value === 'string' && /^[a-f0-9]{1,8}$/i.test(value) ? parseInt(value, 16) : -1;
        p.crc.parameters = { width: Number(crc.width), polynomial: number(crc.polynomial), init: number(crc.init), xorOut: number(crc.xorOut), reflectInput: crc.reflectInput, reflectOutput: crc.reflectOutput };
      }
      const references = [], checks = [];
      const number = (value) => typeof value === 'number' ? value : typeof value === 'string' && /^(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|0x[\da-f]+)$/i.test(value.trim()) ? Number(value) : NaN;
      ordered.forEach((node) => {
        if (node.type !== 'vofa-check') { references.push(...nodeSources(node)); return; }
        const field = references.findIndex((ref) => ref.source === node.source);
        if (field < 0) fail('值校验只能引用连线前方已读取的字段，请重新选择字段。');
        checks.push({ field, operator: node.operator,
          ...(['eq', 'in'].includes(node.operator) ? { values: typeof node.values === 'string' ? node.values.split(/[,;\s]+/).filter(Boolean).map(number) : [] } : {}),
          ...(node.operator === 'range' ? { min: number(node.min), max: number(node.max) } : {}),
          ...(node.operator === 'mask' ? { mask: number(node.mask), value: number(node.value) } : {}) });
      });
      if (checks.length) p.checks = checks;
      const config = { version: 3, wordCount: p.dataMode === 'words' ? data.length : 1, fields: p.dataMode === 'words' ? wordFields : [], protocol: model.normalize(p) };
      const errors = model.validate(config);
      return { valid: !errors.length, errors, config };
    } catch (error) { return { valid: false, errors: [error.message], config: null }; }
  }
  return Object.freeze({ TYPES, ROOT, normalize, seed, empty, compile, seedLegacy, checkSources });
});
