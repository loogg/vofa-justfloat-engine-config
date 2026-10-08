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
      for (const [value, name] of [['fixed', '固定结构协议'], ['justfloat', 'JustFloat 完整协议']]) { const option = document.createElement('option'); option.value = value; option.textContent = name; preset.append(option); }
      const summary = document.createElement('span'); summary.className = 'nr-frame-summary';
      const order = document.createElement('select'); order.setAttribute('aria-label', '数据字节序'); order.id = 'protocol-byte-order';
      for (const [value, name] of [['little', '小端'], ['big', '大端']]) { const option = document.createElement('option'); option.value = value; option.textContent = name; order.append(option); }
      const test = document.createElement('button'); test.type = 'button'; test.className = 'button'; test.textContent = '数据测试';
      toolbar.append(title, preset, order, summary, test); host.append(toolbar);
      const frame = document.createElement('iframe'); frame.id = 'node-red-editor-frame'; frame.title = 'Node-RED 协议节点编辑器'; frame.src = './node-red/index.html'; host.append(frame);
      const pane = document.createElement('section'); pane.className = 'nr-test-pane'; pane.hidden = true;
      const row = document.createElement('div'); row.className = 'nr-test-actions';
      const input = document.createElement('textarea'); input.id = 'protocol-sample'; input.setAttribute('aria-label', '试解析十六进制数据'); input.placeholder = '输入十六进制帧数据，或填入当前协议样例。'; input.maxLength = 800000;
      const fill = document.createElement('button'), parse = document.createElement('button'), close = document.createElement('button');
      for (const button of [fill, parse, close]) { button.type = 'button'; button.className = 'button'; }
      fill.id = 'protocol-fill-sample'; fill.textContent = '填入样例'; parse.id = 'protocol-parse-sample'; parse.textContent = '解析数据'; parse.classList.add('button-primary'); close.textContent = '收起';
      const output = document.createElement('div'); output.id = 'protocol-preview-result'; output.setAttribute('aria-live', 'polite');
      row.append(fill, parse, close); pane.append(row, input, output); host.append(pane);
      let ready = false, loaded = false, lastConfig = '', working = false, accepting = false;
      const send = (type, value = {}) => frame.contentWindow?.postMessage({ channel: 'vofa-node-red', type, ...value }, '*');
      const scene = () => {
        const config = adapter.publicConfig();
        if (!config.canvas) return flows.seed(config);
        if (config.canvas.version === 1) {
          const compiled = flows.compile(config.canvas);
          if (compiled.valid) return flows.seed({ ...config, ...compiled.config, engineName: config.engineName });
        }
        return config.canvas;
      };
      const bootstrap = () => { if (ready) { lastConfig = JSON.stringify(scene()); send('bootstrap', { scene: scene() }); } };
      function render() {
        const config = adapter.config(), errors = adapter.errors();
        title.textContent = config.engineName || '未命名协议';
        preset.value = config.protocol ? 'fixed' : 'justfloat'; preset.disabled = adapter.busy() || !loaded;
        order.value = config.protocol?.byteOrder || 'little'; order.disabled = !config.protocol || adapter.busy() || !loaded;
        fill.disabled = parse.disabled = working || adapter.busy() || errors.length > 0 || !config.protocol;
        let text;
        if (errors.length) text = errors[0];
        else if (config.protocol) { const l = model.layout(config); text = `固定 ${l.frameBytes} Bytes / 帧 · ${l.channels.length} 个通道`; }
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
        const fixed = preset.value === 'fixed';
        if (fixed === Boolean(adapter.config().protocol)) return;
        if (!(await adapter.confirm({ title: '切换协议预设？', message: '当前画布将替换为所选协议的默认节点与连线。', detail: '请先保存需要保留的当前配置。', confirmLabel: '切换预设', tone: 'warning' }))) { render(); return; }
        adapter.update((config) => { delete config.canvas; config.wordCount = 2; config.fields = [0, 1].map(adapter.wordField); if (fixed) { config.version = 3; config.protocol = model.defaults(); } else { config.version = 2; delete config.protocol; } });
      };
      test.onclick = () => { pane.hidden = !pane.hidden; }; close.onclick = () => { pane.hidden = true; };
      async function preview(sample) {
        working = true; output.textContent = '正在解析…'; render();
        try {
          const result = await adapter.api.previewFrame(adapter.publicConfig(), sample ? '' : input.value);
          if (sample) input.value = result.sampleHex;
          output.replaceChildren();
          const status = document.createElement('p'); status.textContent = `识别 ${result.frames.length} 帧 · 拒绝 ${result.rejected} 个候选 · 剩余 ${result.remainingBytes} 字节${result.crcFailure ? ' · CRC 校验不匹配' : ''}`; output.append(status);
          for (const [index, frame] of result.frames.entries()) {
            const heading = document.createElement('strong'); heading.textContent = `帧 ${index + 1} · ${frame.channels.length} 个通道`; output.append(heading);
            const table = document.createElement('table'); table.className = 'protocol-result-table';
            for (const channel of frame.channels) { const row = document.createElement('tr'); for (const value of [`ch${channel.channel}`, channel.name, channel.type, `Byte ${channel.offset}`, String(channel.value)]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } table.append(row); }
            output.append(table);
          }
        } catch (error) { output.textContent = error.message; }
        finally { working = false; render(); }
      }
      fill.onclick = () => preview(true); parse.onclick = () => preview(false);
      render();
      return { render, reset: () => { input.value = ''; output.replaceChildren(); bootstrap(); render(); }, selectWord: () => {}, showMapping: () => { send('show-words'); } };
    }
  };
})();
