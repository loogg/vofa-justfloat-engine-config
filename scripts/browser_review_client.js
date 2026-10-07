(() => {
  "use strict";
  const token = document.querySelector('meta[name="browser-review-token"]')?.content;
  const transport = new URLSearchParams(location.search).get("transport");
  if (!token || location.hostname !== "127.0.0.1" || transport !== "bridge"
      || document.querySelector('meta[name="browser-review-transport"]')?.content !== transport) {
    throw new Error("Development Bridge unavailable or transport mismatch");
  }
  const badge = document.createElement("span");
  badge.className = "review-transport-badge";
  badge.textContent = "Bridge · 真实后端";
  badge.title = "Browser Review 开发模式，通过本地 Bridge 调用真实 Backend Service";
  document.querySelector(".app-actions").prepend(badge);
  const listeners = new Set();
  let active = 0;
  let pumping = false;
  let sequence = Number(document.querySelector('meta[name="browser-review-log-sequence"]')?.content) || 0;
  let currentPrompt = null;
  const completedPrompts = new Set();
  const dialog = document.createElement("dialog");
  dialog.className = "review-dialog";
  dialog.innerHTML = '<form><h2></h2><p class="review-dialog-detail"></p><label>本机路径<input type="text" spellcheck="false" required></label><p class="review-dialog-error" role="alert" hidden></p><footer><button class="button" type="button">取消</button><button class="button button-primary" type="submit">选择</button></footer></form>';
  document.body.append(dialog);
  const form = dialog.querySelector("form");
  const input = dialog.querySelector("input");
  const error = dialog.querySelector('[role="alert"]');
  async function request(route, body) {
    const response = await fetch(`/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Review-Token": token }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) { const failure = new Error(data.error || "Bridge request failed"); failure.code = data.code; throw failure; }
    return data;
  }
  async function finishDialog(canceled) {
    if (!currentPrompt) return;
    try {
      await request("dialog", { id: currentPrompt.id, canceled, value: input.value.trim() });
      completedPrompts.add(currentPrompt.id);
      currentPrompt = null;
      dialog.close();
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); void finishDialog(false); });
  form.querySelector('[type="button"]').addEventListener("click", () => void finishDialog(true));
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); void finishDialog(true); });
  function displayPrompt(prompt) {
    if (currentPrompt || completedPrompts.has(prompt.id)) return;
    currentPrompt = prompt;
    const confirmation = prompt.kind === "confirm";
    dialog.querySelector("h2").textContent = prompt.definition.title;
    dialog.querySelector(".review-dialog-detail").textContent = confirmation
      ? `${prompt.definition.message}\n${prompt.definition.detail}`
      : "输入本机的完整路径。Browser Review 会通过真实后端读取或写入该位置。";
    input.closest("label").hidden = confirmation;
    input.required = !confirmation;
    input.value = prompt.definition.defaultPath || "";
    form.querySelector('[type="submit"]').textContent = confirmation ? "确认迁移并替换" : prompt.kind === "save" ? "保存" : "选择";
    error.hidden = true;
    dialog.showModal();
    if (!confirmation) { input.focus(); input.select(); }
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (active > 0) {
        await receiveEvents();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally { pumping = false; }
  }
  let eventsPending = null;
  function receiveEvents() {
    if (eventsPending) return eventsPending;
    eventsPending = request("events", { after: sequence }).then((data) => {
      sequence = data.sequence;
      data.logs.forEach(({ message }) => listeners.forEach((listener) => listener(message)));
      if (data.prompts[0]) displayPrompt(data.prompts[0]);
    }).finally(() => { eventsPending = null; });
    return eventsPending;
  }
  async function invoke(method, ...args) {
    active += 1;
    const pending = request("call", { method, args: args.map((arg) => arg === undefined ? null : arg) });
    void pump();
    try { return (await pending).result; }
    finally { try { await receiveEvents(); } finally { active -= 1; } }
  }
  const methods = ["getAppInfo", "getEnvironment", "openConfig", "saveConfig", "selectPath", "generate", "build", "openGenerated", "checkUpdate", "openExternal"];
  window.browserReviewApi = Object.freeze({ ...Object.fromEntries(methods.map((method) => [method, (...args) => invoke(method, ...args)])),
    onBuildLog(callback) { if (typeof callback !== "function") throw new TypeError("Build log callback must be a function"); listeners.add(callback); return () => listeners.delete(callback); }
  });
})();
