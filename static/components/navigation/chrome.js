"use strict";

// UI components for chrome.js. Feature state and orchestration remain in that module.

function cmdkRender() {
  const host = $("#cmdkResults");
  if (!cmdk.results.length) {
    host.innerHTML = `<div class="cmdk-none">No matches</div>`;
    return;
  }
  host.innerHTML = cmdk.results.map((r, i) => {
    const cover = r.row ? coverSrc(ENRICH[r.row._k], "cover_small") : "";
    const art = r.row
      ? (cover ? `<img src="${escapeHtml(cover)}" alt="">` : `<span class="cmdk-ph">${icon("i-library", 15)}</span>`)
      : "";
    return `<button class="cmdk-item${i === cmdk.sel ? " sel" : ""}" data-i="${i}">
      ${art}<span class="cmdk-txt"><b>${escapeHtml(r.label)}</b>${r.sub ? `<span>${escapeHtml(r.sub)}</span>` : ""}</span>
      <span class="cmdk-kind">${escapeHtml(r.kind)}</span></button>`;
  }).join("");
  const sel = host.querySelector(".cmdk-item.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
  host.querySelectorAll(".cmdk-item").forEach((el) => {
    el.onclick = () => cmdkRun(+el.dataset.i);
  });
}

function showToast(msg, ico) {
  const t = $("#toast");
  // An optional site icon in place of text marks like "✓" — status reads as UI,
  // not as punctuation bolted onto the sentence.
  t.innerHTML = (ico ? icon(ico, 14) + " " : "") + escapeHtml(msg);
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 250); }, 2500);
}

function applyAdminUI() {
  const acct = $("#account");
  $("#refresh").hidden = !IS_ADMIN;          // the endpoint is gated too; hide the button
  // The Wishlist tab lists the account owner's platform wishlist — owner-only, and the
  // data endpoint is gated to match. Hidden in the markup by default (no flash for the
  // public); revealed only once we know we're signed in.
  const wl = $("#tabWishlist");
  if (wl) wl.hidden = !IS_ADMIN;
  // Swipe accepts recommendations into the staged-edit overlay, so the whole
  // screen is owner-only just like Wishlist and the write endpoints it uses.
  const swipe = $("#tabSwipe");
  if (swipe) swipe.hidden = !IS_ADMIN;
  // Health (the data-quality dashboard over the collection) is owner-only too. Its whole
  // "Admin" group in the menu hides for the public, so there's no empty section header.
  const health = $("#tabHealth");
  if (health) health.hidden = !IS_ADMIN;
  // The seasonal-event preview board moves the app's clock. Same group, same reason.
  const evb = $("#tabEvents");
  if (evb) evb.hidden = !IS_ADMIN;
  const adminGrp = $("#navAdmin");
  if (adminGrp) adminGrp.hidden = !IS_ADMIN;
  if (!acct) return;
  if (IS_ADMIN) {
    acct.title = `Signed in as ${ME.username} · account`;
    acct.setAttribute("aria-label", "Account");
    acct.classList.add("signed-in");
    // Your initial in the accent coin — the signed-in state you can see at a glance.
    acct.textContent = String(ME.username || "?").trim().charAt(0).toUpperCase() || "?";
  } else {
    acct.title = "Sign in";
    acct.setAttribute("aria-label", "Sign in");
    acct.classList.remove("signed-in");
    acct.innerHTML = icon("i-user", 16);
  }
}

function openAuthModal(inner) {
  closeAuthModal();
  authDialog = openUiDialog({ html: inner, className: "auth", panelClass: "ce-narrow",
    onClose: () => { authDialog = null; } });
  return authDialog.host;
}

function openLoginDialog() {
  const host = openAuthModal(`
      <h3>Sign in</h3>
      <div class="ce-sub">Admin access</div>
      <form id="loginForm" class="auth-form" autocomplete="on">
        <label>Username<input id="loginUser" type="text" autocomplete="username" autofocus></label>
        <label>Password<input id="loginPass" type="password" autocomplete="current-password"></label>
        <p class="auth-err" id="loginErr" hidden></p>
        <div class="ce-acts"><span></span><div class="ce-right">
          <button class="sh-btn" type="button" id="loginCancel">Cancel</button>
          <button class="sh-btn primary" type="submit">Sign in</button>
        </div></div>
      </form>`);
  const err = host.querySelector("#loginErr");
  host.querySelector("#loginCancel").onclick = closeAuthModal;
  host.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const username = host.querySelector("#loginUser").value.trim();
    const password = host.querySelector("#loginPass").value;
    try {
      const r = await fetch("api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (r.ok) { closeAuthModal(); location.reload(); return; }
      err.textContent = r.status === 401 ? "Wrong username or password." : "Sign in failed.";
      err.hidden = false;
    } catch (_) { err.textContent = "Couldn't reach the server."; err.hidden = false; }
  });
}

function openAccountMenu() {
  const host = openAuthModal(`
      <h3>${escapeHtml(ME.username)}</h3>
      <div class="ce-sub">Signed in</div>
      <div class="auth-menu">
        <button class="sh-btn" id="acctPlat" type="button">${icon("i-play", 14)} Linked platforms</button>
        <button class="sh-btn" id="acctPw" type="button">${icon("i-lock", 14)} Change password</button>
        <button class="sh-btn" id="acctOut" type="button">Log out</button>
      </div>`);
  host.querySelector("#acctPlat").onclick = openPlatformsDialog;
  host.querySelector("#acctPw").onclick = openPasswordDialog;
  host.querySelector("#acctOut").onclick = async () => {
    try { await fetch("api/logout", { method: "POST" }); } catch (_) {}
    closeAuthModal(); location.reload();
  };
}

function openPasswordDialog() {
  const host = openAuthModal(`
      <h3>Change password</h3>
      <div class="ce-sub">${escapeHtml(ME.username)}</div>
      <form id="pwForm" class="auth-form">
        <label>Current password<input id="pwCur" type="password" autocomplete="current-password" autofocus></label>
        <label>New password<input id="pwNew" type="password" autocomplete="new-password"></label>
        <label>Confirm new password<input id="pwNew2" type="password" autocomplete="new-password"></label>
        <p class="auth-err" id="pwErr" hidden></p>
        <div class="ce-acts"><span></span><div class="ce-right">
          <button class="sh-btn" type="button" id="pwCancel">Cancel</button>
          <button class="sh-btn primary" type="submit">Update</button>
        </div></div>
      </form>`);
  const err = host.querySelector("#pwErr");
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  host.querySelector("#pwCancel").onclick = closeAuthModal;
  host.querySelector("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const cur = host.querySelector("#pwCur").value;
    const nw = host.querySelector("#pwNew").value;
    const nw2 = host.querySelector("#pwNew2").value;
    if (nw.length < 8) return fail("New password must be at least 8 characters.");
    if (nw !== nw2) return fail("The new passwords don't match.");
    try {
      const r = await fetch("api/account/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: cur, new_password: nw }),
      });
      if (r.ok) { closeAuthModal(); showToast("Password changed", "i-check"); return; }
      if (r.status === 403) return fail("Your current password is wrong.");
      const j = await r.json().catch(() => ({}));
      fail(j.detail || "Couldn't change the password.");
    } catch (_) { fail("Couldn't reach the server."); }
  });
}
