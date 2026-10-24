"use strict";

// One lifecycle for prompts, confirmations, account and edit dialogs. Content is
// trusted application HTML; callers must escape interpolated data.
const uiDialogStack = [];
function openUiDialog({ html, family = "modal", className = "", panelClass = "",
  label = "", role = "dialog", onClose = () => {}, dismissValue = null } = {}) {
  const prompt = family === "prompt";
  const host = document.createElement("div");
  const previousFocus = document.activeElement;
  host.className = `${prompt ? "np-scrim" : "ce-scrim"}${className ? " " + className : ""}`;
  host.innerHTML = `<div class="${prompt ? "np-box" : "ce"} ${escapeHtml(panelClass)}" role="${escapeHtml(role)}" aria-modal="true"${label ? ` aria-label="${escapeHtml(String(label))}"` : ""}>
    ${prompt ? "" : '<button type="button" class="ce-x" aria-label="Close">✕</button>'}${html}</div>`;
  let done = false;
  const close = (result = dismissValue) => {
    if (done) return;
    done = true;
    const top = uiDialogStack.at(-1) === host;
    uiDialogStack.splice(uiDialogStack.indexOf(host), 1);
    document.removeEventListener("keydown", onKey, true);
    host.remove();
    if (typeof syncScrollLock === "function") syncScrollLock();
    if (top && previousFocus?.isConnected) previousFocus.focus();
    onClose(result);
  };
  const onKey = (event) => {
    if (uiDialogStack.at(-1) !== host || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation(); // don't also close the underlying game drawer
    close();
  };
  host.addEventListener(prompt ? "click" : "mousedown", (event) => {
    if (event.target === host && uiDialogStack.at(-1) === host) close();
  });
  if (!prompt) host.querySelector(".ce-x").onclick = () => close();
  document.body.appendChild(host);
  uiDialogStack.push(host);
  document.addEventListener("keydown", onKey, true);
  if (typeof syncScrollLock === "function") syncScrollLock();
  return { host, close };
}

// A native, in-app replacement for window.prompt — used for "name this view/picker".
// It looks like the rest of the site instead of the OS chrome, and its input is 16px
// so iOS doesn't zoom the page on focus. Returns a Promise of the trimmed name, or
// null if cancelled/empty. Registers as an overlay (.np-scrim) for the scroll lock.
function uiPrompt({ title, value = "", placeholder = "", ok = "Save", maxlength = 40 } = {}) {
  return new Promise((resolve) => {
    const html = `
        <label class="np-title" for="npInput">${escapeHtml(title || "")}</label>
        <input id="npInput" class="np-input" type="text" autocomplete="off" spellcheck="false"
               maxlength="${maxlength}" placeholder="${escapeHtml(placeholder)}" />
        <div class="np-actions">
          <button type="button" class="np-btn" data-np="cancel">Cancel</button>
          <button type="button" class="np-btn np-ok" data-np="ok">${escapeHtml(ok)}</button>
        </div>
      `;
    const { host, close } = openUiDialog({ html, family: "prompt", label: title,
      onClose: resolve, dismissValue: null });
    const input = host.querySelector("#npInput");
    input.value = value;
    const commit = () => close(input.value.trim() || null);
    host.querySelector('[data-np="cancel"]').onclick = () => close(null);
    host.querySelector('[data-np="ok"]').onclick = commit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commit(); }
    });
    // Focus + select so a suggested name can just be overtyped.
    requestAnimationFrame(() => { if (host.isConnected) { input.focus(); input.select(); } });
  });
}

// Companion to uiPrompt — a native yes/no dialog in place of window.confirm, for the
// handful of destructive actions that ask before they wipe something. Resolves true
// on confirm, false on cancel/backdrop/Escape. Pass danger:true to redden the button.
function uiConfirm({ title = "", body = "", ok = "OK", cancel = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const html = `
        ${title ? `<div class="np-title">${escapeHtml(title)}</div>` : ""}
        <div class="np-body">${escapeHtml(body)}</div>
        <div class="np-actions">
          <button type="button" class="np-btn" data-np="cancel">${escapeHtml(cancel)}</button>
          <button type="button" class="np-btn np-ok${danger ? " np-danger" : ""}" data-np="ok">${escapeHtml(ok)}</button>
        </div>
      `;
    const { host, close } = openUiDialog({ html, family: "prompt", label: title,
      role: "alertdialog", onClose: resolve, dismissValue: false });
    host.querySelector('[data-np="cancel"]').onclick = () => close(false);
    host.querySelector('[data-np="ok"]').onclick = () => close(true);
    host.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); close(true); }
    });
    requestAnimationFrame(() => { if (host.isConnected) host.querySelector('[data-np="ok"]').focus(); });
  });
}
