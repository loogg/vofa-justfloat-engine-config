(() => {
  'use strict';
  const defs = [];
  const row = (key, label, control = 'input') => `<div class="form-row"><label for="node-input-${key}">${label}</label>${control === 'input' ? `<input id="node-input-${key}" type="text">` : control}</div>`;
  const select = (key, options) => `<select id="node-input-${key}">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
  const template = (type, markup) => { const script = document.createElement('script'); script.type = 'text/html'; script.dataset.templateName = type; script.textContent = markup; document.body.append(script); };
  const add = (type, label, color, inputs, outputs, defaults, markup, extra = {}) => {
    template(type, row('name', '名称') + markup);
    defs.push({ type, definition: { category: '帧结构', color, inputs, outputs, defaults: { name: { value: '' }, ...defaults }, icon: 'font-awesome/fa-cube', label: function () { return this.name || label; }, paletteLabel: label, ...extra } });
  };
  const hex = (value) => typeof value === 'string' && value.replace(/\s/g, '').length > 0 && /^(?:[0-9a-f]{2}){1,64}$/i.test(value.replace(/\s/g, ''));
  add('vofa-header', '帧头', '#dedede', 0, 1, { hex: { value: 'AA55', required: true, validate: hex } }, row('hex', '帧头 HEX'), { icon: 'font-awesome/fa-sign-in' });
  add('vofa-tail', '帧尾', '#dedede', 1, 1, { hex: { value: '0D0A', required: true, validate: hex } }, row('hex', '帧尾 HEX'), { icon: 'font-awesome/fa-sign-out' });
  add('vofa-output', 'VOFA+ 输出', '#d7dda3', 1, 0, {}, '<p class="vofa-node-help">此节点定义一条采样帧链的终点。连线完整后可试解析并生成数据引擎。</p>', { icon: 'font-awesome/fa-line-chart' });
  add('vofa-justfloat', 'JustFloat 协议', '#c0deed', 0, 1, {}, '<p class="vofa-node-help">后面直接连接 4 字节 Word，配置普通采样帧的映射。保留原有帧尾扫描、图片帧、4 字节对齐及动态后续 Word。</p>', { icon: 'font-awesome/fa-th-list' });
  const algorithms = [...Object.entries(ProtocolModel.CRCS).filter(([key]) => key !== 'none').map(([key, value]) => [key, value.label]), ['custom', '自定义 CRC 参数']];
  add('vofa-crc', 'CRC 校验', '#e6d6ed', 1, 1, {
    algorithm: { value: 'crc16-modbus', required: true }, scope: { value: 'data', required: true }, byteOrder: { value: 'little', required: true },
    width: { value: 16 }, polynomial: { value: '8005' }, init: { value: 'FFFF' }, xorOut: { value: '0' }, reflectInput: { value: true }, reflectOutput: { value: true }
  }, row('algorithm', '算法', select('algorithm', algorithms)) + row('scope', '校验范围', select('scope', [['data', '仅数据域'], ['header-data', '帧头 + 数据域']])) + row('byteOrder', 'CRC 字节序', select('byteOrder', [['little', '小端'], ['big', '大端']])) +
    '<div class="vofa-crc-custom">' + row('width', '位宽', select('width', [[8, '8 bits'], [16, '16 bits'], [32, '32 bits']])) + row('polynomial', '多项式 HEX') + row('init', '初始值 HEX') + row('xorOut', '结果异或 HEX') + row('reflectInput', '输入反射', '<input type="checkbox" id="node-input-reflectInput">') + row('reflectOutput', '输出反射', '<input type="checkbox" id="node-input-reflectOutput">') + '</div>',
    { icon: 'font-awesome/fa-check-circle', oneditprepare: function () { const toggle = () => $('.vofa-crc-custom').toggle($('#node-input-algorithm').val() === 'custom'); $('#node-input-algorithm').on('change', toggle); toggle(); }, oneditsave: function () { this.width = Number($('#node-input-width').val()); } });
  add('vofa-word', '4 字节 Word', '#c0deed', 1, 1, { mappings: { value: [] } }, '<p class="vofa-node-help">每个 Word 固定 4 字节，在其内部配置字节与位映射。</p><div id="vofa-word-mapping"></div>',
    { category: '数据域', icon: 'font-awesome/fa-th', oneditprepare: function () { this._mappingEditor = VofaWordMapping(document.getElementById('vofa-word-mapping'), this.mappings); }, oneditsave: function () { this.mappings = this._mappingEditor.fields(); delete this._mappingEditor; }, oneditcancel: function () { delete this._mappingEditor; } });
  for (const type of [...Object.keys(ProtocolModel.TYPES), 'reserved']) {
    const extra = type === 'reserved' ? row('bytes', '保留字节数') : type === 'bit' ? row('bitOffset', '字节内位位置', select('bitOffset', Array.from({ length: 8 }, (_, i) => [i, `Bit ${i}`]))) : '';
    add(`vofa-${type}`, type === 'reserved' ? '保留字节' : type === 'float' ? 'float32' : type, '#c0deed', 1, 1,
      { ...(type === 'reserved' ? { bytes: { value: 1, required: true, validate: (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 4096 } } : {}), ...(type === 'bit' ? { bitOffset: { value: 0 } } : {}) },
      extra + `<p class="vofa-node-help">${type === 'reserved' ? '计入帧长，不输出通道。' : type === 'bit' ? '占用 1 字节容器，输出指定状态位。' : `占用 ${ProtocolModel.TYPES[type]} 字节，字段值不会改变帧长。`}</p>`,
      { category: '数据域', icon: 'font-awesome/fa-tag', oneditsave: function () { if (type === 'reserved') this.bytes = Number($('#node-input-bytes').val()); if (type === 'bit') this.bitOffset = Number($('#node-input-bitOffset').val()); } });
  }
  window.VofaNodeDefinitions = defs;
})();
