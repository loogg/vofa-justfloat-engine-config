(() => {
  'use strict';
  let scene = null, loaded = false, restoring = false, lastSnapshot = '', publishTimer;
  const send = (type, value = {}) => window.parent.postMessage({ channel: 'vofa-node-red', type, ...value }, '*');
  const types = VofaNodeDefinitions.map((entry) => entry.type);
  const settings = {
    version: '5.0.8', telemetryEnabled: false, flowFilePretty: true, runtimeState: { enabled: false, ui: false }, diagnostics: { enabled: false, ui: false },
    externalModules: { palette: { allowInstall: false, allowUpload: false }, modules: { allowInstall: false } },
    editorTheme: { projects: { enabled: false }, multiplayer: { enabled: false }, tours: false, userMenu: false, languages: ['zh-CN', 'en-US'],
      palette: { editable: false }, codeEditor: { lib: 'ace' }, deployButton: { type: 'simple', label: '应用协议' },
      menu: { 'menu-item-import-library': false, 'menu-item-export-library': false, 'menu-item-edit-palette': false, 'menu-item-projects-menu': false, 'menu-item-context': false, 'menu-item-subflow': false } }
  };
  const route = (options) => {
    const url = options.url.replace(/^\.\//, '').split('?')[0], accept = options.headers?.Accept || options.dataType;
    if (url === 'theme') return { header: { title: '协议编辑器 · Node-RED' } };
    if (url === 'settings') return settings;
    if (url === 'settings/user') {
      if ((options.type || 'GET').toUpperCase() === 'POST') { localStorage.setItem('vofa-node-red-preferences', options.data); return {}; }
      let preferences;
      try { preferences = JSON.parse(localStorage.getItem('vofa-node-red-preferences') || '{}'); } catch { preferences = {}; }
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
      preferences.editor = preferences.editor || {};
      preferences.editor.sidebar = preferences.editor.sidebar || {};
      preferences.editor.sidebar.state = preferences.editor.sidebar.state || {
        v: 4, tabs: ['palette', 'explorer', 'info', 'help', 'config'],
        primary: { width: 280, top: { tabs: ['info', 'help', 'config'], active: 'info' }, bottom: { tabs: [] } },
        secondary: { width: 190, top: { tabs: ['palette', 'explorer'], active: 'palette' }, bottom: { tabs: [] } }
      };
      return preferences;
    }
    if (url === 'plugins') return accept === 'text/html' ? '' : [];
    if (['plugins/messages', 'nodes/messages', 'icons'].includes(url)) return {};
    if (url === 'nodes') return accept === 'text/html' ? '<!-- vofa trusted node definitions --><div></div>' : [{ id: 'vofa/protocol', name: 'protocol', module: 'vofa', version: '1', types, enabled: true, local: true }];
    if (url === 'flows') return { rev: 'local-editor', flows: scene.flows };
    if (url === 'library') return [];
    if (/^credentials\//.test(url)) return {};
    return undefined;
  };
  // Adapt only editor metadata routes. No Node-RED server, filesystem endpoint,
  // runtime nodes or execution service is exposed by this frontend adapter.
  $.ajaxTransport('+*', (options) => {
    const result = route(options);
    if (result === undefined) return;
    return { send: (_headers, complete) => {
      setTimeout(() => {
        if (options.url.split('?')[0] === 'nodes' && options.headers?.Accept === 'text/html') {
          for (const entry of VofaNodeDefinitions) if (!RED.nodes.getType(entry.type)) RED.nodes.registerType(entry.type, entry.definition);
        }
        complete(200, 'OK', typeof result === 'string' ? { text: result } : { json: result }, `Content-Type: ${typeof result === 'string' ? 'text/html' : 'application/json'}`);
      }, 0);
    }, abort: () => {} };
  });
  const originalAjax = $.ajax;
  $.ajax = function (options, second) {
    const request = typeof options === 'string' ? { ...second, url: options } : { ...options };
    if (/^(?:red|vendor)\//.test(request.url)) request.url = `./vendor/${request.url}`;
    if (request.dataType === 'script' && /^\.\/vendor\/(?:red|vendor)\/[A-Za-z0-9_./-]+(?:\?.*)?$/.test(request.url) && !request.url.includes('..')) {
      const deferred = $.Deferred(), script = document.createElement('script');
      script.onload = () => { request.success?.(); deferred.resolve(); };
      script.onerror = () => { request.error?.(); deferred.reject(); };
      script.src = request.url; document.head.append(script);
      return deferred.promise();
    }
    return originalAjax.call($, request);
  };
  RED.i18n.init = function (_options, done) {
    RED._ = (...args) => { const value = i18next.t(...args); return typeof value === 'string' ? value : args[0]; };
    i18next.init({ showSupportNotice: false, lng: 'zh-CN', fallbackLng: 'en-US', resources: VofaNodeRedMessages,
      ns: ['editor', 'node-red', 'jsonata', 'infotips'], defaultNS: 'editor', fallbackNS: 'editor', returnObjects: true,
      interpolation: { escapeValue: false, prefix: '__', suffix: '__' } }, () => { jqueryI18next.init(i18next, $, { handleName: 'i18n' }); done(); });
  };
  RED.i18n.loadPluginCatalogs = (done) => done();
  RED.i18n.loadNodeCatalogs = (done) => done();
  RED.i18n.loadNodeCatalog = (_namespace, done) => done();
  RED.comms.connect = () => {};
  RED.comms.subscribe = () => {};
  RED.comms.unsubscribe = () => {};
  function filterPalette() {
    const palette = document.getElementById('red-ui-palette');
    if (palette) palette.dataset.vofaKind = scene.kind;
    for (const type of types) {
      const visible = scene.kind === 'justfloat' ? ['vofa-justfloat', 'vofa-word', 'vofa-output'].includes(type) : type !== 'vofa-justfloat';
      RED.palette[visible ? 'show' : 'hide'](type);
    }
  }
  const snapshot = () => ({ ...scene, flows: RED.nodes.createCompleteNodeSet() });
  function publish() {
    if (!loaded || restoring) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      const current = snapshot(), serialized = JSON.stringify(current);
      if (serialized !== lastSnapshot) { lastSnapshot = serialized; send('change', { scene: current }); }
    }, 100);
  }
  function load(next) {
    scene = next;
    restoring = true;
    RED.nodes.clear(); RED.history.clear();
    RED.nodes.import(scene.flows); RED.nodes.dirty(false);
    RED.workspaces.show(scene.flows.find((node) => node.type === 'tab').id);
    RED.view.redraw(true); filterPalette();
    lastSnapshot = JSON.stringify(snapshot());
    restoring = false;
    send('loaded', { scene: snapshot() });
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.channel !== 'vofa-node-red') return;
    if (event.data.type === 'bootstrap') {
      if (loaded) load(event.data.scene);
      else if (!scene) { scene = event.data.scene; RED.init({ apiRootUrl: '' }); }
    } else if (event.data.type === 'status') {
      const status = document.getElementById('vofa-flow-status');
      status.textContent = event.data.text; status.classList.toggle('is-error', !event.data.valid);
    } else if (event.data.type === 'byte-order' && loaded) {
      scene.byteOrder = event.data.value;
      publish();
    } else if (event.data.type === 'show-words' && loaded) {
      RED.workspaces.show(scene.flows.find((node) => node.type === 'tab').id);
    }
  });
  RED.events.on('flows:loaded', () => {
    loaded = true;
    RED.sidebar.removeTab('context');
    const push = RED.history.push, pop = RED.history.pop;
    RED.history.push = function (...args) { const result = push.apply(this, args); publish(); return result; };
    RED.history.pop = function (...args) { const result = pop.apply(this, args); publish(); return result; };
    RED.events.on('workspace:change', filterPalette);
    for (const event of ['nodes:add', 'nodes:remove', 'nodes:change', 'links:add', 'links:remove', 'editor:save']) RED.events.on(event, publish);
    filterPalette();
    requestAnimationFrame(() => { filterPalette(); RED.actions.invoke('core:zoom-fit'); });
    const palette = document.getElementById('red-ui-palette');
    if (palette) new MutationObserver(filterPalette).observe(palette, { childList: true, subtree: true });
    lastSnapshot = JSON.stringify(snapshot());
    send('loaded', { scene: snapshot() });
    RED.loader.end();
  });
  send('ready');
})();
