(() => {
  'use strict';
  const defs = [];
  const row = (key, label, control = 'input', helpKey = key) => `<div class="form-row">${VofaPropertyHelp.markup(label, helpKey, 'node-input-' + key)}${control === 'input' ? `<input id="node-input-${key}" type="text">` : control}</div>`;
  const select = (key, options) => `<select id="node-input-${key}">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
  const template = (type, markup) => { const script = document.createElement('script'); script.type = 'text/html'; script.dataset.templateName = type; script.textContent = markup; document.body.append(script); };
  const add = (type, label, color, inputs, outputs, defaults, markup, extra = {}) => {
    template(type, row('name', '名称') + markup);
    defs.push({ type, definition: { category: '帧结构', color, inputs, outputs, defaults: { name: { value: '' }, ...defaults }, icon: 'font-awesome/fa-cube', label: function () { return this.name || label; }, paletteLabel: label, ...extra } });
  };
  const hex = (value) => typeof value === 'string' && value.replace(/\s/g, '').length > 0 && /^(?:[0-9a-f]{2}){1,64}$/i.test(value.replace(/\s/g, ''));
  const headers = (value) => {
    if (typeof value !== 'string') return false;
    const list = value.split(/[\n;,]+/).map((entry) => entry.trim().replace(/\s/g, '').toUpperCase()).filter(Boolean);
    return list.length > 0 && list.length <= 32 && list.every(hex) && list.every((entry) => entry.length === list[0].length) && new Set(list).size === list.length;
  };
  add('vofa-receive', '接收流', '#dedede', 0, 1, { framing: { value: 'fixed', required: true }, repeat: { value: true }, images: { value: false } },
    row('framing', '收帧方式', select('framing', [['fixed', '按字段结构定长'], ['delimited', '按帧尾结束']])) +
    '<div class="vofa-delimited">' + row('repeat', '后续 Word', '<input type="checkbox" id="node-input-repeat"><span class="vofa-inline-help">每 4 字节追加 float32 通道</span>') +
    row('images', '图片兼容', '<input type="checkbox" id="node-input-images"><span class="vofa-inline-help">保留 JustFloat 图片帧；添加值校验时关闭</span>') + '</div>' +
    '<p class="vofa-node-help">接收流是必需起点，可编辑和移动，不能删除，不占用协议字节。后面可选连接帧头；没有帧头时必须配置帧尾。字段校验失败从候选起点后移 1 字节重找；半帧保留并等待后续数据。</p>',
    { icon: 'font-awesome/fa-sign-in', label: function () { return (this.name || '接收流') + ' · ' + (this.framing === 'delimited' ? '按帧尾' : '定长'); }, oneditprepare: function () { VofaEndpointPolicy.prepareEditor(RED, this, document); const toggle = () => $('.vofa-delimited').toggle($('#node-input-framing').val() === 'delimited'); $('#node-input-framing').on('change', toggle); toggle(); }, oneditsave: function () { if ($('#node-input-framing').val() === 'fixed') this.images = false; } });
  add('vofa-header', '帧头匹配', '#dedede', 1, 1, { hex: { value: 'AA55', required: true, validate: headers } },
    row('hex', '候选 HEX', '<textarea id="node-input-hex" rows="4" placeholder="AA 55&#10;AA 56"></textarea>', 'header') +
    '<p class="vofa-node-help">每行一个候选，也可用分号分隔。匹配任意一个；所有候选必须等长，最多 32 个。无帧头协议直接省略此节点。</p>', { icon: 'font-awesome/fa-search' });
  add('vofa-check', '值校验', '#dedede', 1, 1, { source: { value: '', required: true }, operator: { value: 'eq', required: true }, values: { value: '1' }, min: { value: '0' }, max: { value: '255' }, mask: { value: '0xFF' }, value: { value: '1' } },
    row('source', '已读字段', '<select id="node-input-source"></select>') +
    row('operator', '条件', select('operator', [['eq', '等于'], ['in', '属于允许值集合'], ['range', '在范围内（含边界）'], ['mask', '位掩码匹配']])) +
    '<div class="vofa-check-values">' + row('values', '允许值') + '</div>' +
    '<div class="vofa-check-range">' + row('min', '下限') + row('max', '上限') + '</div>' +
    '<div class="vofa-check-mask">' + row('mask', '掩码') + row('value', '匹配值') + '</div>' +
    '<p class="vofa-node-help">本节点不占字节。引用连线前方的原始字段值，满足条件才继续；否则从候选帧起点后移 1 字节重新搜索。整数支持十进制和 0x 十六进制；多个允许值用逗号分隔。位掩码：字段值 &amp; 掩码 = 匹配值。</p>',
    { icon: 'font-awesome/fa-check', oneditprepare: function () {
      const field = document.getElementById('node-input-source');
      const choices = ProtocolFlow.checkSources({ flows: RED.nodes.createCompleteNodeSet() }, this.id);
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = choices.length ? '选择前方已读取的字段' : '请先连接一个前方字段'; field.append(empty);
      for (const choice of choices) { const option = document.createElement('option'); option.value = choice.source; option.textContent = choice.label; field.append(option); }
      field.value = this.source || '';
      const toggle = () => { const op = $('#node-input-operator').val(); $('.vofa-check-values').toggle(op === 'eq' || op === 'in'); $('.vofa-check-range').toggle(op === 'range'); $('.vofa-check-mask').toggle(op === 'mask'); };
      $('#node-input-operator').on('change', toggle); toggle();
    } });
  add('vofa-tail', '帧尾', '#dedede', 1, 1, { hex: { value: '0D0A', required: true, validate: hex } }, row('hex', '帧尾 HEX', 'input', 'tail'), { icon: 'font-awesome/fa-sign-out' });
  add('vofa-output', 'VOFA+ 输出', '#d7dda3', 1, 0, {}, '<p class="vofa-node-help">此节点是必需终点，可编辑和移动，不能删除。连线完整后可试解析并生成数据引擎。</p>', { icon: 'font-awesome/fa-line-chart', oneditprepare: function () { VofaEndpointPolicy.prepareEditor(RED, this, document); } });
  add('vofa-justfloat', 'JustFloat 协议', '#c0deed', 0, 1, {}, '<p class="vofa-node-help">后面直接连接 4 字节 Word，配置普通采样帧的映射。保留原有帧尾扫描、图片帧、4 字节对齐及动态后续 Word。</p>', { icon: 'font-awesome/fa-th-list' });
  const algorithms = [...Object.entries(ProtocolModel.CRCS).filter(([key]) => key !== 'none').map(([key, value]) => [key, value.label]), ['custom', '自定义 CRC 参数']];
  add('vofa-crc', 'CRC 校验', '#e6d6ed', 1, 1, {
    algorithm: { value: 'crc16-modbus', required: true }, scope: { value: 'data', required: true }, byteOrder: { value: 'little', required: true },
    width: { value: 16 }, polynomial: { value: '8005' }, init: { value: 'FFFF' }, xorOut: { value: '0' }, reflectInput: { value: true }, reflectOutput: { value: true }
  }, row('algorithm', '算法', select('algorithm', algorithms)) + row('scope', '校验范围', select('scope', [['data', '仅数据域'], ['header-data', '帧头 + 数据域']])) + row('byteOrder', 'CRC 字节序', select('byteOrder', [['little', '小端'], ['big', '大端']])) +
    '<div class="vofa-crc-custom">' + row('width', '位宽', select('width', [[8, '8 bits'], [16, '16 bits'], [32, '32 bits']])) + row('polynomial', '多项式 HEX') + row('init', '初始值 HEX') + row('xorOut', '结果异或 HEX') + row('reflectInput', '输入反射', '<input type="checkbox" id="node-input-reflectInput">') + row('reflectOutput', '输出反射', '<input type="checkbox" id="node-input-reflectOutput">') + '</div>',
    { icon: 'font-awesome/fa-check-circle', oneditprepare: function () { const toggle = () => $('.vofa-crc-custom').toggle($('#node-input-algorithm').val() === 'custom'); $('#node-input-algorithm').on('change', toggle); toggle(); }, oneditsave: function () { this.width = Number($('#node-input-width').val()); } });
  const outputRow = row('output', '输出通道', '<input type="checkbox" id="node-input-output"><span class="vofa-inline-help">关闭后仅占字节，可用于值校验</span>');
  add('vofa-word', '4 字节 Word', '#c0deed', 1, 1, { mappings: { value: [] }, output: { value: true } }, outputRow + '<p class="vofa-node-help">每个 Word 固定 4 字节，在其内部配置字节与位映射。</p><div id="vofa-word-mapping"></div>',
    { category: '数据域', icon: 'font-awesome/fa-th', oneditprepare: function () { $('#node-input-output').prop('checked', this.output !== false); this._mappingEditor = VofaWordMapping(document.getElementById('vofa-word-mapping'), this.mappings); }, oneditsave: function () { this.mappings = this._mappingEditor.fields(); delete this._mappingEditor; }, oneditcancel: function () { delete this._mappingEditor; } });
  for (const type of [...Object.keys(ProtocolModel.TYPES), 'reserved']) {
    const extra = type === 'reserved' ? row('bytes', '保留字节数') : type === 'bit' ? row('bitOffset', '字节内位位置', select('bitOffset', Array.from({ length: 8 }, (_, i) => [i, `Bit ${i}`]))) : '';
    add(`vofa-${type}`, type === 'reserved' ? '保留字节' : type === 'float' ? 'float32' : type, '#c0deed', 1, 1,
      { ...(type === 'reserved' ? { bytes: { value: 1, required: true, validate: (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 4096 } } : { output: { value: true } }), ...(type === 'bit' ? { bitOffset: { value: 0 } } : {}) },
      extra + (type === 'reserved' ? '' : outputRow) + `<p class="vofa-node-help">${type === 'reserved' ? '计入帧长，不输出通道。' : type === 'bit' ? '占用 1 字节容器，输出指定状态位。' : `占用 ${ProtocolModel.TYPES[type]} 字节，字段值不会改变帧长。`}</p>`,
      { category: '数据域', icon: 'font-awesome/fa-tag', oneditprepare: function () { if (type !== 'reserved') $('#node-input-output').prop('checked', this.output !== false); }, oneditsave: function () { if (type === 'reserved') this.bytes = Number($('#node-input-bytes').val()); if (type === 'bit') this.bitOffset = Number($('#node-input-bitOffset').val()); } });
  }
  window.VofaNodeDefinitions = defs;
})();
