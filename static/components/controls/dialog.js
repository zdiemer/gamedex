"use strict";

// One lifecycle for prompts, confirmations, account and edit dialogs. Content is
// trusted application HTML; callers must escape interpolated data.
const uiDialogStack = [];
/**
 * @component Open the standard modal or prompt shell using the shared dialog lifecycle.
 * @param {Object} options - Dialog configuration.
 * @param {string} options.html - Trusted dialog contents.
 * @param {"modal"|"prompt"} [options.family="modal"] - Prompt uses .np-*; other values use .ce-* and a close button.
 * @param {string} [options.className=""] - Extra scrim classes.
 * @param {string} [options.panelClass=""] - Extra panel classes.
 * @param {string} [options.label=""] - Accessible name; supply a label or label content appropriately.
 * @param {string} [options.role="dialog"] - ARIA role, usually dialog or alertdialog.
 * @param {function(*):void} [options.onClose=()=>{}] - Called once with the close result.
 * @param {*} [options.dismissValue=null] - Result used for Escape, backdrop or the close button.
 * @returns {{host: HTMLElement, close: function(*):void}} Dialog handle; close(result) is idempotent.
 * @requires escapeHtml, mountUiDialog; .ce-* or .np-* styles; app syncScrollLock when available.
 * @events Only the top dialog handles Escape/backdrop. Caller owns initial focus, form actions and content handlers. This helper does not trap Tab focus.
 * @cleanup Always call close(), including on route teardown or host replacement. It removes the host/listeners, updates scroll locking, invokes onClose and restores prior focus when connected.
 * @escaping html is trusted renderer output. label, role and panelClass are escaped; className is assigned through the DOM className property.
 * @example
 * const dialog = openUiDialog({ html: "<h3>Details</h3>", label: "Details" });
 * dialog.host.querySelector(".ce-x").focus();
 * // On route teardown:
 * dialog.close();
 */
function openUiDialog({ html, family = "modal", className = "", panelClass = "",
  label = "", role = "dialog", onClose = () => {}, dismissValue = null } = {}) {
  const prompt = family === "prompt";
  const host = document.createElement("div");
  host.className = `${prompt ? "np-scrim" : "ce-scrim"}${className ? " " + className : ""}`;
  host.innerHTML = `<div class="${prompt ? "np-box" : "ce"} ${escapeHtml(panelClass)}" role="${escapeHtml(role)}" aria-modal="true"${label ? ` aria-label="${escapeHtml(String(label))}"` : ""}>
    ${prompt ? "" : '<button type="button" class="ce-x" aria-label="Close">✕</button>'}${html}</div>`;
  const dialog = mountUiDialog(host, { onClose, dismissValue,
    backdropEvent: prompt ? "click" : "mousedown" });
  if (!prompt) host.querySelector(".ce-x").onclick = () => dialog.close();
  return dialog;
}

// Adopt a specialized shell (manual viewer or theme browser) into the same
// lifecycle. Connected hosts keep their placement and inherited feature styles.
/**
 * @component Adopt a specialized dialog shell into the shared lifecycle.
 * @param {HTMLElement} host - Scrim with a role=dialog or role=alertdialog descendant; mount each host only once.
 * @param {Object} [options={}] - Lifecycle hooks.
 * @param {function(*):void} [options.onClose=()=>{}] - Called once after removal.
 * @param {*} [options.dismissValue=null] - Default close result.
 * @param {string} [options.backdropEvent="click"] - Backdrop dismissal event; standard modals use mousedown.
 * @param {function(*):HTMLElement|null} [options.returnFocus=null] - Resolve a focus target after close; otherwise use the initially focused element.
 * @returns {{host: HTMLElement, close: function(*):void}} A handle for idempotent dismissal.
 * @requires Browser document; uiDialogStack from this file; optional syncScrollLock. Caller supplies shell styles.
 * @events Connected hosts retain their parent; detached hosts are appended to body. Captures top-dialog Escape and backdrop events; caller wires close buttons. Does not trap Tab focus.
 * @cleanup Use close() before removing the host or leaving its route. Caller must clear its own timers/subscriptions in onClose. Keeping a mounted host across a repaint preserves stack position.
 * @escaping Does not sanitize supplied DOM; construct the shell with escaped external content.
 * @example
 * const dialog = mountUiDialog(host, { onClose: () => clearTimeout(timer) });
 * host.querySelector("[data-close]").onclick = () => dialog.close();
 */
function mountUiDialog(host, { onClose = () => {}, dismissValue = null,
  backdropEvent = "click", returnFocus = null } = {}) {
  const previousFocus = document.activeElement;
  let done = false;
  const close = (result = dismissValue) => {
    if (done) return;
    done = true;
    const top = uiDialogStack.at(-1) === host;
    uiDialogStack.splice(uiDialogStack.indexOf(host), 1);
    document.removeEventListener("keydown", onKey, true);
    host.removeEventListener(backdropEvent, onBackdrop);
    host.remove();
    if (typeof syncScrollLock === "function") syncScrollLock();
    onClose(result);
    const previous = returnFocus ? returnFocus(result) : previousFocus; // a caller may have repainted its trigger
    if (top && previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const onKey = (event) => {
    if (uiDialogStack.at(-1) !== host || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation(); // don't also close the underlying game drawer
    close();
  };
  const onBackdrop = (event) => {
    if (event.target === host && uiDialogStack.at(-1) === host) close();
  };
  host.addEventListener(backdropEvent, onBackdrop);
  host.querySelector('[role="dialog"], [role="alertdialog"]')?.setAttribute("aria-modal", "true");
  if (!host.isConnected) document.body.appendChild(host);
  uiDialogStack.push(host);
  document.addEventListener("keydown", onKey, true);
  if (typeof syncScrollLock === "function") syncScrollLock();
  return { host, close };
}

// A native, in-app replacement for window.prompt — used for "name this view/picker".
// It looks like the rest of the site instead of the OS chrome, and its input is 16px
// so iOS doesn't zoom the page on focus. Returns a Promise of the trimmed name, or
// null if cancelled/empty. Registers as an overlay (.np-scrim) for the scroll lock.
/**
 * @component Ask for a trimmed name using the shared prompt dialog.
 * @param {Object} [options={}] - Prompt options.
 * @param {string} [options.title=""] - Input label and dialog name.
 * @param {string} [options.value=""] - Initial input value; focused and selected on the next frame.
 * @param {string} [options.placeholder=""] - Input hint.
 * @param {string} [options.ok="Save"] - Submit label.
 * @param {number} [options.maxlength=40] - Trusted positive integer character limit.
 * @returns {Promise<string|null>} Trimmed nonempty name, or null for dismissal/empty input.
 * @requires openUiDialog, escapeHtml and prompt styles.
 * @events Enter submits; Cancel, Escape and backdrop dismiss. Only one #npInput prompt should be open at a time.
 * @cleanup The dialog closes itself on completion and removes its listeners. No external close handle is returned.
 * @escaping Labels and placeholder are escaped; value is assigned via input.value. maxlength is a trusted numeric attribute.
 * @example
 * const name = await uiPrompt({ title: "Name this collection", value: "Favorites" });
 * if (name !== null) saveName(name);
 */
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
/**
 * @component Ask a yes/no question using the shared confirmation dialog.
 * @param {Object} [options={}] - Confirmation options.
 * @param {string} [options.title=""] - Accessible dialog name.
 * @param {string} [options.body=""] - Plain message text.
 * @param {string} [options.ok="OK"] - Confirm label.
 * @param {string} [options.cancel="Cancel"] - Cancel label.
 * @param {boolean} [options.danger=false] - Destructive-action appearance.
 * @returns {Promise<boolean>} True on confirmation; false on Cancel, Escape or backdrop dismissal.
 * @requires openUiDialog, escapeHtml and prompt styles.
 * @events Focuses the confirm button on the next frame; Enter confirms. Callers perform any business action only after awaiting the result.
 * @cleanup The dialog closes itself and removes its listeners; no external close handle is returned.
 * @escaping All text is escaped. body does not accept HTML.
 * @example
 * if (await uiConfirm({ title: "Delete collection?", body: "This removes the collection.", danger: true })) deleteCollection();
 */
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
