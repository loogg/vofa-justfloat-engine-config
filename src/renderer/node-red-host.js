(() => {
  'use strict';
  const model = window.ProtocolModel, flows = window.ProtocolFlow;
  window.ProtocolEditor = {
    create(adapter) {
      const host = document.getElementById('protocol-editor');
      host.replaceChildren();
      const toolbar = document.createElement('div'); toolbar.className = 'nr-protocol-toolbar';
      const title = document.createElement('button'); title.type = 'button'; title.className = 'nr-document-title'; title.onclick = adapter.openProject;
      const preset = document.createElement('select'); preset.id = 'protocol-preset'; preset.setAttribute('aria-label', '协议预设');
      for (const [value, name] of [['', '添加协议预设…'], ['fixed', '定长帧预设'], ['justfloat', 'JustFloat 预设']]) { const option = document.createElement('option'); option.value = value; option.textContent = name; preset.append(option); }
      const summary = document.createElement('span'); summary.className = 'nr-frame-summary';
      const order = document.createElement('select'); order.setAttribute('aria-label', '数据字节序'); order.id = 'protocol-byte-order';
      for (const [value, name] of [['little', '小端'], ['big', '大端']]) { const option = document.createElement('option'); option.value = value; option.textContent = name; order.append(option); }
      const test = document.createElement('button'); test.type = 'button'; test.className = 'button'; test.textContent = '数据测试';
      const resetCanvas = document.createElement('button'); resetCanvas.type = 'button'; resetCanvas.id = 'protocol-reset-canvas'; resetCanvas.className = 'button';
      const resetIcon = document.createElement('span'); resetIcon.className = 'icon icon-refresh'; resetIcon.setAttribute('aria-hidden', 'true'); resetCanvas.append(resetIcon, document.createTextNode('重置画布'));
      toolbar.append(title, preset, order, resetCanvas, summary, test); host.append(toolbar);
      const frame = document.createElement('iframe'); frame.id = 'node-red-editor-frame'; frame.title = 'Node-RED 协议节点编辑器'; frame.src = './node-red/index.html'; host.append(frame);
      const pane = document.createElement('section'); pane.className = 'nr-test-pane'; pane.hidden = true;
      const row = document.createElement('div'); row.className = 'nr-test-actions';
      const input = document.createElement('textarea'); input.id = 'protocol-sample'; input.setAttribute('aria-label', '试解析十六进制数据'); input.placeholder = '输入十六进制帧数据，或填入当前协议样例。'; input.maxLength = 800000;
      const fill = document.createElement('button'), parse = document.createElement('button'), close = document.createElement('button');
      for (const button of [fill, parse, close]) { button.type = 'button'; button.className = 'button'; }
      fill.id = 'protocol-fill-sample'; fill.textContent = '填入样例'; parse.id = 'protocol-parse-sample'; parse.textContent = '解析数据'; parse.classList.add('button-primary'); close.textContent = '收起';
      const output = document.createElement('div'); output.id = 'protocol-preview-result'; output.setAttribute('aria-live', 'polite');
      row.append(fill, parse, close); pane.append(row, input, output); host.append(pane);
      let ready = false, loaded = false, lastConfig = '', lastEditorRevision = -1, working = false, accepting = false;
      const send = (type, value = {}) => frame.contentWindow?.postMessage({ channel: 'vofa-node-red', type, ...value }, '*');
      const scene = () => {
        const config = adapter.publicConfig();
        if (!config.canvas) return flows.seed(config);
        if (config.canvas.version < 3) {
          const compiled = flows.compile(config.canvas);
          if (compiled.valid) return flows.seed({ ...config, ...compiled.config, engineName: config.engineName });
        }
        return config.canvas;
      };
      const bootstrap = () => { if (ready) { lastConfig = JSON.stringify(scene()); send('bootstrap', { scene: scene(), dirty: adapter.dirty() }); } };
      function render() {
        const config = adapter.config(), errors = adapter.errors();
        title.textContent = config.engineName || '未命名协议';
        preset.value = ''; preset.disabled = adapter.busy() || !loaded;
        order.value = config.canvas?.byteOrder || config.protocol?.byteOrder || 'little'; order.disabled = adapter.busy() || !loaded;
        resetCanvas.disabled = working || adapter.busy() || !loaded;
        fill.disabled = parse.disabled = working || adapter.busy() || errors.length > 0;
        let text;
        if (config.canvas?.version === 3 && config.canvas.flows.filter((node) => !['tab', 'vofa-receive', 'vofa-output'].includes(node.type)).length === 0) text = '请在接收流与输出之间插入协议模块';
        else if (errors.length) text = errors[0];
        else if (config.protocol) { const l = model.layout(config); text = config.protocol.kind === 'delimited' ? `按帧尾收帧 · ${l.channels.length} 个配置通道` : `固定 ${l.frameBytes} Bytes / 帧 · ${l.channels.length} 个通道`; }
        else text = `JustFloat · 变长收帧 · ${config.wordCount} 个配置 Word`;
        summary.textContent = text; summary.classList.toggle('is-error', errors.length > 0);
        const busy = adapter.busy();
        frame.inert = busy;
        frame.style.pointerEvents = busy ? 'none' : '';
        send('status', { text, valid: !errors.length, busy });
        const current = JSON.stringify(scene());
        if (loaded && !accepting && current !== lastConfig) bootstrap();
      }
      const receive = (event) => {
        if (event.source !== frame.contentWindow || event.data?.channel !== 'vofa-node-red'
            || event.origin !== (location.protocol === 'file:' ? 'null' : location.origin)) return;
        if (event.data.type === 'ready') { ready = true; bootstrap(); }
        if (['loaded', 'change'].includes(event.data.type)) {
          try {
            const canvas = flows.normalize(event.data.scene), result = flows.compile(canvas);
            lastEditorRevision = event.data.revision;
            accepting = true;
            if (event.data.type === 'change') adapter.update((config) => {
              config.canvas = canvas;
              if (result.valid) {
                Object.assign(config, result.config);
                if (result.config.version === 2) delete config.protocol;
                config.fields = config.fields.map((field) => ({ ...adapter.wordField(field.wordIndex), ...field }));
              }
            });
            else { adapter.config().canvas = canvas; loaded = true; }
            lastConfig = JSON.stringify(scene());
            accepting = false; render();
          } catch (error) { accepting = false; adapter.toast('画布配置无效', error.message, 'error'); }
        }
      };
      window.addEventListener('message', receive);
      order.onchange = () => send('byte-order', { value: order.value });
      preset.onchange = async () => {
        if (!preset.value) return;
        const fixed = preset.value === 'fixed';
        if (!(await adapter.confirm({ title: '应用协议预设？', message: '当前画布将替换为所选预设的节点与连线。', detail: '请先保存需要保留的当前配置。', confirmLabel: '应用预设', tone: 'warning' }))) { render(); return; }
        adapter.update((config) => { delete config.canvas; config.wordCount = 2; config.fields = [0, 1].map(adapter.wordField); if (fixed) { config.version = 3; config.protocol = model.defaults(); } else { config.version = 2; delete config.protocol; } });
      };
      resetCanvas.onclick = async () => {
        if (!(await adapter.confirm({ title: '重置协议画布？', message: '将移除画布中的协议模块与连线，恢复一对接收流和 VOFA+ 输出。', detail: '引擎名称和工程设置会保留。请先保存需要保留的配置。', confirmLabel: '重置画布', tone: 'warning' }))) return;
        adapter.update((config) => { config.version = 3; config.wordCount = 1; config.fields = []; config.protocol = model.defaults(); config.canvas = flows.empty(config.engineName); });
        input.value = ''; output.replaceChildren(); pane.hidden = true;
      };
      test.onclick = () => { pane.hidden = !pane.hidden; }; close.onclick = () => { pane.hidden = true; };
      async function preview(sample) {
        working = true; output.textContent = '正在解析…'; render();
        try {
          const result = await adapter.api.previewFrame(adapter.publicConfig(), sample ? '' : input.value);
          if (sample) input.value = result.sampleHex;
          output.replaceChildren();
          const status = document.createElement('p'); status.textContent = `识别 ${result.frames.length} 帧 · 拒绝 ${result.rejected} 个候选 · 剩余 ${result.remainingBytes} 字节${result.crcFailure ? ' · CRC 校验不匹配' : ''}${result.checkFailure ? ' · 字段 ' + (result.checkFailure.field || '未命名') + ' 值校验失败' : ''}`; output.append(status);
          for (const [index, frame] of result.frames.entries()) {
            const heading = document.createElement('strong'); heading.textContent = `帧 ${index + 1} · ${frame.imageSize ? '图片 ' + frame.imageSize + ' 字节' : frame.channels.length + ' 个通道'}`; output.append(heading);
            const table = document.createElement('table'); table.className = 'protocol-result-table';
            for (const channel of frame.channels) { const row = document.createElement('tr'); for (const value of [`ch${channel.channel}`, channel.name, channel.type, `Byte ${channel.offset}`, String(channel.value)]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } table.append(row); }
            output.append(table);
          }
        } catch (error) { output.textContent = error.message; }
        finally { working = false; render(); }
      }
      fill.onclick = () => preview(true); parse.onclick = () => preview(false);
      render();
      return { render, setDocumentDirty: (dirty) => send('document-state', { dirty: Boolean(dirty), savedRevision: lastEditorRevision }), reset: () => { input.value = ''; output.replaceChildren(); bootstrap(); render(); }, selectWord: () => {}, showMapping: () => { send('show-words'); } };
    }
  };
})();
