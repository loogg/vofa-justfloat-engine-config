(() => {
  'use strict';
  const widths = { bit: 1, uint8: 8, int8: 8, uint16: 16, int16: 16, uint32: 32, int32: 32, float: 32 };
  window.VofaWordMapping = function (host, input) {
    const fields = JSON.parse(JSON.stringify(input || [])).map((field, index) => ({ ...field, _refId: field._refId ?? String(index) }));
    let selected = -1;
    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
    const wrap = el('div', 'vofa-mapping'), left = el('div'), form = el('div', 'vofa-mapping-form');
    const grid = el('div', 'vofa-mapping-grid'), list = el('div', 'vofa-mapping-fields'); left.append(grid, list); wrap.append(left, form); host.append(wrap);
    const name = el('input'), type = el('select'), offset = el('select'), error = el('p', 'vofa-mapping-error');
    const output = el('input'); output.type = 'checkbox'; output.checked = true;
    for (const [key, width] of Object.entries(widths)) { const option = el('option', '', `${key} · ${width} bits`); option.value = key; type.append(option); }
    for (const [label, control, key, id] of [['通道名称', name, 'mappingName', 'name'], ['字段类型', type, 'mappingType', 'type'], ['位位置', offset, 'mappingOffset', 'offset']]) {
      const property = el('div', 'vofa-mapping-property'); control.id = 'vofa-mapping-' + id; control.setAttribute('aria-label', label);
      property.append(VofaPropertyHelp.caption(label, key, control.id), control); form.append(property);
    }
    output.id = 'vofa-mapping-output'; output.setAttribute('aria-label', '输出为通道');
    const outputLabel = el('div', 'vofa-mapping-output'); outputLabel.append(output, VofaPropertyHelp.caption('输出为通道', 'mappingOutput', output.id)); form.append(outputLabel);
    const actions = el('div', 'vofa-mapping-actions'), save = el('button', 'red-ui-button', '添加'), remove = el('button', 'red-ui-button', '删除'), reset = el('button', 'red-ui-button', '新字段');
    for (const button of [save, remove, reset]) button.type = 'button'; actions.append(save, remove, reset); form.append(actions, error);
    host.append(el('p', 'vofa-precision', 'Word 始终占用 4 字节。空映射按 float32 输出；所有通道写入 float，uint32 / int32 超过 16,777,216 可能损失整数精度。'));
    const occupied = (start, width) => fields.some((field, index) => index !== selected && start < field.bitOffset + widths[field.type] && field.bitOffset < start + width);
    function positions(preferred = 0) {
      offset.replaceChildren();
      const width = widths[type.value];
      for (let bit = 0; bit + width <= 32; bit += type.value === 'bit' ? 1 : 8) {
        const option = el('option', '', type.value === 'bit' ? `Bit ${bit}` : `Byte ${bit / 8}–${(bit + width) / 8 - 1}`);
        option.value = bit; option.disabled = occupied(bit, width); offset.append(option);
      }
      const chosen = [...offset.options].find((option) => Number(option.value) === preferred && !option.disabled) || [...offset.options].find((option) => !option.disabled);
      if (chosen) offset.value = chosen.value;
      offset.disabled = save.disabled = !chosen;
    }
    function edit(index) {
      selected = index; const field = fields[index]; name.value = field.name; type.value = field.type; output.checked = field.output !== false; positions(field.bitOffset); draw();
    }
    function draw() {
      grid.replaceChildren(); list.replaceChildren();
      for (let byte = 0; byte < 4; byte++) {
        grid.append(el('span', 'byte-label', `Byte ${byte}`));
        for (let bit = 7; bit >= 0; bit--) {
          const absolute = byte * 8 + bit;
          const index = fields.findIndex((field) => absolute >= field.bitOffset && absolute < field.bitOffset + widths[field.type]);
          const button = el('button', index < 0 ? '' : 'has-field', String(absolute)); button.type = 'button';
          button.classList.toggle('is-selected', index >= 0 && selected === index);
          button.title = index >= 0 ? `${fields[index].name || `ch${index}`} · ${fields[index].type}` : `未占用 Bit ${absolute}`;
          button.setAttribute('aria-label', button.title);
          button.onclick = () => { if (index >= 0) edit(index); else { selected = -1; output.checked = true; name.value = `ch${fields.length}`; type.value = 'bit'; positions(absolute); draw(); } };
          grid.append(button);
        }
      }
      fields.forEach((field, index) => { const button = el('button', '', `${field.name || `ch${index}`} · ${field.type} · Bits ${field.bitOffset}–${field.bitOffset + widths[field.type] - 1}${field.output === false ? ' · 仅校验' : ''}`); button.type = 'button'; button.onclick = () => edit(index); list.append(button); });
      if (!fields.length) list.append(el('p', 'vofa-node-help', '当前整块默认输出 float32。添加第一个字段后，按字段映射解码。'));
      save.textContent = selected >= 0 ? '更新' : '添加'; remove.disabled = selected < 0;
    }
    save.onclick = () => {
      const start = Number(offset.value), width = widths[type.value];
      if (!width || !Number.isInteger(start) || start < 0 || start + width > 32 || occupied(start, width)) { error.textContent = '字段位置越界或重叠，请选择空白位置。'; return; }
      const value = { name: name.value.trim().slice(0, 48), type: type.value, bitOffset: start, _refId: selected < 0 ? crypto.randomUUID() : fields[selected]._refId, ...(output.checked ? {} : { output: false }) };
      if (selected < 0) fields.push(value); else fields[selected] = value;
      selected = -1; output.checked = true; error.textContent = ''; name.value = `ch${fields.length}`; positions(); draw();
    };
    remove.onclick = () => { if (selected >= 0) fields.splice(selected, 1); selected = -1; output.checked = true; name.value = `ch${fields.length}`; positions(); draw(); };
    reset.onclick = () => { selected = -1; output.checked = true; name.value = `ch${fields.length}`; positions(); draw(); };
    type.onchange = () => positions(Number(offset.value));
    name.value = `ch${fields.length}`; type.value = 'bit'; positions(); draw();
    return { fields: () => fields.map((field) => ({ ...field })) };
  };
})();
