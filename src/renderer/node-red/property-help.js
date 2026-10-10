(() => {
  'use strict';
  const descriptions = Object.freeze({
    name: '给模块起一个便于识别的名称。数据字段的名称还会显示在测试结果和通道说明中。名称不会改变协议的字节数。',
    framing: '按字段结构定长：根据连线中的字段、CRC 和帧尾计算整帧长度。\n按帧尾结束：扫描帧尾来确定一帧的结束位置，适合 JustFloat 等协议。没有帧头时必须配置帧尾。',
    repeat: '读完已配置的数据后，把帧尾前多出的数据按每 4 字节一个 float32 继续输出。\n全部使用 Word 时，短帧只解析实际存在的 Word；混合定宽字段时，必须先收齐配置的数据域。',
    images: '保留 JustFloat 的图片帧、帧尾扫描和 4 字节对齐规则。只适用于无帧头、小端 Word、后续 Word 和 00 00 80 7F 帧尾。\n需要添加值校验、CRC 或其他字段时，请关闭此选项。',
    header: '帧头用于寻找一帧可能的起点。每行填写一个十六进制候选，所有候选的字节数必须一致，匹配任意一个即可。\n例如：第一行 AA 55，第二行 AA 56。最多 32 个候选；没有帧头时省略此模块。',
    tail: '标记一帧的结束，填写完整的十六进制字节。\n例如：0D 0A 表示两个字节；JustFloat 使用 00 00 80 7F。按帧尾结束时，这个序列应作为保留分隔符，避免出现在前面的数据中。',
    source: '选择连线前方已经读取的字段，也可以选 Word 内部的字段。判断使用原始数值，早于 float 输出转换。\n先连接数据字段，再选择它；字段被删除后，需要重新选择校验对象。',
    operator: '等于：只接受一个指定值。\n允许值集合：接受列出的任意一个值。\n范围：接受上下限之间的值，包含边界。\n位掩码：只比较选中的位。条件失败会从候选帧起点后移 1 字节重找。',
    values: '填写允许接收的字段值。等于条件填一个值；集合条件用逗号分隔多个值。\n例如：1, 2, 0x10。整数支持十进制和 0x 十六进制；有符号数可填 -1，float 可填 2.5。数值必须符合字段类型。',
    min: '允许接收的最小值，包含这个值。\n例如：下限 -40、上限 125，表示接受 -40 到 125。下限不能大于上限。',
    max: '允许接收的最大值，包含这个值。\n例如：下限 0、上限 100，0 和 100 都会通过校验。',
    mask: '用二进制中为 1 的位选择要检查的位置，其他位忽略。只适用于无符号整数和 bit。\n例如：0xF0 选择一个字节的高 4 位；0x0F 选择低 4 位。',
    value: '位掩码运算后应该得到的值：字段值 & 掩码 = 匹配值。匹配值在掩码以外的位必须为 0。\n例如：字段 0xA3、掩码 0xF0、匹配值 0xA0，会通过校验。',
    algorithm: '选择发送端协议规定的 CRC 算法。预设会自动使用该算法的位宽、多项式、初始值和反射参数。\n发送端没有 CRC 时，直接省略 CRC 模块；已有协议的参数与预设不一致时选择自定义。',
    scope: '选择参与 CRC 计算的原始字节。数据域包含输出字段、未输出字段和保留字节。\n帧头 + 数据域会额外计算实际匹配的帧头；CRC 值本身和帧尾不参与计算。',
    byteOrder: '决定多字节 CRC 值在帧中如何存放，与数据字段的字节序分别配置。\nCRC 数值为 0x1234 时：小端发送 34 12，大端发送 12 34。CRC-8 只有一个字节，不受此选项影响。',
    width: 'CRC 校验值的位数，同时决定它在帧中占多少字节。\n8 位占 1 字节，16 位占 2 字节，32 位占 4 字节。其余 CRC 参数必须在所选位宽范围内。',
    polynomial: 'CRC 计算使用的生成多项式，按发送端协议填写十六进制数，不带 0x 前缀。\n这里不写最高阶的隐含位。例如 CRC-16/MODBUS 填 8005，而不是 18005 或反射实现中的 A001。',
    init: '计算每一帧 CRC 之前，校验寄存器使用的起始值。填写十六进制数，不带 0x 前缀。\n例如：CRC-16/MODBUS 使用 FFFF；不是数据字段的默认值。',
    xorOut: '完成 CRC 计算和输出反射后，最终结果再与这个数异或。填写十六进制数，不带 0x 前缀。\n0 表示不再修改结果。必须与发送端的算法参数一致。',
    reflectInput: '计算 CRC 时，是否把每个输入字节的 8 个位逆序。\n它会改变 CRC 算法的计算方式，不能代替字节序设置；按发送端算法的 RefIn 参数选择。',
    reflectOutput: '完成 CRC 运算后，是否把所选位宽内的结果位逆序，再执行结果异或。\n按发送端算法的 RefOut 参数选择，与 CRC 值的存储字节序相互独立。',
    output: '开启时把解析值作为 VOFA+ 通道输出。关闭后仍读取这些字节、参与值校验和 CRC，但不增加输出通道。\nWord 的总开关关闭时，其内部字段也不会输出；配置中至少保留一个输出字段。',
    bytes: '占用并跳过多少字节，不输出通道，但仍计入帧长和 CRC 范围。\n例如：协议中有 3 个不需要显示的填充字节，就填写 3。可填 1–4096。',
    bitOffset: '选择这个字节内的哪一位作为状态值输出，结果是 0 或 1。\nBit 0 是最低位，Bit 7 是最高位。这个模块仍占用完整的 1 字节；需要在同一容器中配置多个状态位时，使用 Word 位映射。',
    mappingName: '给 Word 内部的字段命名，便于在校验列表、测试结果和通道说明中识别。最多 48 个字符，不影响字段所占的位。',
    mappingType: '决定如何解释选中的位，以及占用多少空间。\nbit 占 1 位；uint8 / int8 占 1 字节；uint16 / int16 占 2 字节；uint32 / int32 / float 占 4 字节。uint 是无符号整数，int 支持负数，float 是 float32。\n整数输出为 float 后，超过 24 位精度时可能失真；值校验使用原始值。',
    mappingOffset: '选择字段在这个 4 字节 Word 中的位置。Byte 0 是 Word 的首字节；Bit 0 是 Byte 0 的最低位，Bit 31 是 Byte 3 的最高位。\n整数和 float 从字节边界开始；已被其他字段占用的位置不能选择。',
    mappingOutput: '是否把这个字段输出为一个通道。关闭后仍按原位置读取，可作为值校验对象。\nWord 的总输出开关也必须开启，内部字段才会输出。'
  });
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function markup(label, key, controlId) {
    if (!descriptions[key]) throw new Error('Missing property help: ' + key);
    return '<span class="vofa-property-caption"><label for="' + escape(controlId) + '">' + escape(label) + '</label>' +
      '<button type="button" class="vofa-help-trigger" aria-label="' + escape(label) + '参数说明" data-property-help="' + escape(descriptions[key]) + '">' +
      '<span class="vofa-help-icon" aria-hidden="true"></span></button></span>';
  }
  function caption(label, key, controlId) {
    const wrapper = document.createElement('div'); wrapper.innerHTML = markup(label, key, controlId); return wrapper.firstElementChild;
  }
  const tooltip = document.createElement('div');
  tooltip.id = 'vofa-property-tooltip'; tooltip.className = 'vofa-property-tooltip'; tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
  document.body.append(tooltip);
  let active = null, dismissed = null, timer = null;
  const trigger = (target) => target instanceof Element ? target.closest('.vofa-help-trigger') : null;
  const clearTimer = () => { clearTimeout(timer); timer = null; };
  function hide() {
    clearTimer(); active?.removeAttribute('aria-describedby'); active = null; tooltip.hidden = true;
  }
  function position() {
    if (!active?.isConnected || !active.getClientRects().length) { hide(); return; }
    const rect = active.getBoundingClientRect(), width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
    tooltip.style.top = Math.max(8, rect.bottom + height + 8 <= window.innerHeight - 8 ? rect.bottom + 8 : rect.top - height - 8) + 'px';
  }
  function show(button, explicit = false) {
    if (button === dismissed && !explicit) return;
    clearTimer(); if (active !== button) active?.removeAttribute('aria-describedby');
    active = button; if (explicit) dismissed = null;
    tooltip.textContent = button.dataset.propertyHelp; tooltip.hidden = false;
    button.setAttribute('aria-describedby', tooltip.id); position();
  }
  function scheduleHide() {
    clearTimer();
    timer = setTimeout(() => {
      if (active && !active.matches(':hover, :focus') && !tooltip.matches(':hover')) hide();
    }, 120);
  }
  document.addEventListener('mouseover', (event) => { const button = trigger(event.target); if (button) show(button); });
  document.addEventListener('mouseout', (event) => {
    const button = trigger(event.target);
    if (button && !button.contains(event.relatedTarget)) { if (dismissed === button) dismissed = null; scheduleHide(); }
  });
  document.addEventListener('focusin', (event) => { const button = trigger(event.target); if (button) show(button); else if (!tooltip.contains(event.target)) hide(); });
  document.addEventListener('focusout', (event) => { if (trigger(event.target) === dismissed) dismissed = null; if (trigger(event.target)) scheduleHide(); });
  document.addEventListener('click', (event) => {
    const button = trigger(event.target);
    if (button) show(button, true); else if (!tooltip.contains(event.target)) hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) { dismissed = active; hide(); event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  tooltip.addEventListener('mouseenter', clearTimer); tooltip.addEventListener('mouseleave', scheduleHide);
  window.addEventListener('resize', () => { if (active) position(); });
  document.addEventListener('scroll', () => { if (active) position(); }, true);
  new MutationObserver(() => { if (active && (!active.isConnected || !active.getClientRects().length)) hide(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  window.VofaPropertyHelp = Object.freeze({ markup, caption });
})();
