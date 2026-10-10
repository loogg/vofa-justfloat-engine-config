(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VofaEndpointPolicy = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const types = ['vofa-receive', 'vofa-output'];
  const installed = new WeakSet();
  const isEndpoint = (node) => types.includes(node?.type);
  const hasEndpoint = (RED, type, workspace) => RED.nodes.filterNodes({ type, z: workspace }).length > 0;
  // Keep the first endpoint of each type. Extra nodes in imported drafts remain
  // removable so an invalid canvas can still be repaired.
  const isProtected = (RED, node) => isEndpoint(node) && RED.nodes.filterNodes({ type: node.type, z: node.z })[0]?.id === node.id;
  function insertionNodes(input, workspace) {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const blocked = (node) => isEndpoint(node) || ['tab', 'subflow', 'global-config'].includes(node?.type) || node?.type?.startsWith('subflow:');
    const excluded = new Set(entries.filter(blocked).map((node) => node.id).filter(Boolean));
    return entries.filter((node) => !blocked(node)).map((node) => ({
      ...node, z: workspace,
      ...(node.wires ? { wires: node.wires.map((ports) => ports.filter((id) => !excluded.has(id))) } : {}),
      ...(node.nodes ? { nodes: node.nodes.filter((id) => !excluded.has(id)) } : {}),
      ...(excluded.has(node.g) ? { g: undefined } : {})
    }));
  }
  const canLink = (link) => link.source?.type !== 'vofa-output' && link.target?.type !== 'vofa-receive' && link.source?.z === link.target?.z;
  function containsProtected(RED, node) {
    return isProtected(RED, node) || node.type === 'group' && RED.group.getNodes(node, true).some((child) => isProtected(RED, child));
  }
  function prepareEditor(RED, node, document) {
    if (!isProtected(RED, node)) return;
    const button = document.getElementById('node-dialog-delete');
    if (button) {
      button.disabled = true;
      button.classList.add('disabled');
      button.setAttribute('aria-disabled', 'true');
      button.title = '必需端点，可以编辑和移动，不能删除。';
    }
  }
  function install(RED, { system = () => false } = {}) {
    if (installed.has(RED)) return;
    installed.add(RED);
    const add = RED.nodes.add, importNodes = RED.nodes.import, addLink = RED.nodes.addLink;
    RED.nodes.add = function (node, ...args) {
      if (!system() && isEndpoint(node)) {
        const error = new Error('接收流和输出由画布自动创建，不能额外添加。'); error.code = 'NODE_RED'; throw error;
      }
      return add.call(this, node, ...args);
    };
    RED.nodes.import = function (input, options) {
      if (system()) return importNodes.call(this, input, options);
      const insertable = insertionNodes(input, RED.workspaces.active());
      return insertable.length ? importNodes.call(this, insertable, { ...options, addFlow: false }) : undefined;
    };
    RED.nodes.addLink = function (link) {
      if (!system() && !canLink(link)) { RED.notify('协议模块只能连接在接收流之后、输出之前。', 'info'); return; }
      return addLink.call(this, link);
    };
    for (const method of ['show', 'refresh']) {
      const search = RED.typeSearch[method];
      RED.typeSearch[method] = function (options = {}) { return search.call(this, { ...options, filter: { ...options.filter, input: true, output: true } }); };
    }
    for (const name of ['core:delete-selection', 'core:delete-selection-and-reconnect', 'core:cut-selection-to-internal-clipboard', 'core:copy-selection-to-internal-clipboard', 'core:convert-to-subflow']) {
      const original = RED.actions.get(name);
      RED.actions.remove(name);
      RED.actions.add(name, function (...args) {
        const selection = RED.view.selection(), nodes = selection.nodes || [];
        const movable = nodes.filter((node) => !containsProtected(RED, node));
        if (movable.length === nodes.length) return original.apply(this, args);
        if (name === 'core:convert-to-subflow') {
          RED.notify('接收流和 VOFA+ 输出必须保留在主画布，不能移入子流程。', 'info');
          return;
        }
        const copying = name === 'core:copy-selection-to-internal-clipboard';
        if (copying && !movable.length) { RED.notify('接收流和输出由画布自动创建，复制只包含中间模块。', 'info'); return; }
        if (!copying) RED.notify('接收流和 VOFA+ 输出是必需端点，已保留。包含端点的分组请先取消分组再删除。', 'info');
        if (!movable.length && (!selection.links?.length || copying)) return;
        RED.view.select({ nodes: movable, links: selection.links || [] });
        try { return original.apply(this, args); }
        finally { if (copying) RED.view.select(selection); }
      });
    }
  }
  return Object.freeze({ isEndpoint, hasEndpoint, isProtected, insertionNodes, canLink, prepareEditor, install });
});
