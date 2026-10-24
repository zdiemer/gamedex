"use strict";

// UI components for launch.js. Feature state and orchestration remain in that module.

function nasSectionHtml(row) {
  if (!NAS.generatedAt) return "";                       // no index posted yet
  const hit = NAS.games[row._k];
  if (hit) {
    const size = nasBytes(hit.size);
    return `<div class="nas-line on">
      ${icon("i-check", 14)}
      <div><b>In the ROM library</b>
        <span>${escapeHtml(hit.file || "")}${size ? ` · ${size}` : ""} · ${escapeHtml(hit.system)}</span>
      </div></div>`;
  }
  if ((NAS.unindexed || []).includes(row.platform)) {
    return `<div class="nas-line unknown">
      ${icon("i-alert", 14)}
      <div><b>Not indexed</b>
        <span>${escapeHtml(row.platform)} receipts don't name their games, so we can't say</span>
      </div></div>`;
  }
  return `<div class="nas-line off">
    ${icon("i-close", 14)}
    <div><b>Not in the ROM library</b><span>Nothing on the NAS for this one</span></div>
  </div>`;
}

// After an upload/remove, refresh the open drawer's hero cover in place.
function refreshDrawerCover() {
  if ($("#overlay").hidden || !drawerRow) return;
  const cs = coverSrc(ENRICH[drawerRow._k], "cover_big");
  const el = $("#heroCover");
  if (!cs || !el) return;
  if (el.tagName === "IMG") { el.src = cs; return; }
  const img = document.createElement("img");
  img.className = "cover-big"; img.id = "heroCover"; img.alt = ""; img.src = cs;
  el.replaceWith(img);
}

function rommHtml(row) {
  const rom = rommRomId(row);
  if (!rom) return "";
  const how = rom.stream ? "Stream it from the emulator host via RomM" : "Play in the browser via RomM";
  return `<a class="btn play" href="${escapeHtml(rommPlayUrl(rom))}" target="_blank" rel="noopener"
     title="${how}">${icon("i-play", 15)} Play now</a>`;
}

// The map arrives after the drawer (or the pick) may already be on screen; fill the buttons
// in rather than re-render (the same trap the enrichment map set five times over).
function patchPlayButtons() {
  const body = $("#drawerBody");
  if (body && drawerRow && !body.querySelector(".btn.play")) {
    const html = rommHtml(drawerRow);
    if (html) {
      const host = body.querySelector(".hero-actions");
      if (host) host.insertAdjacentHTML("afterbegin", html);
      else {
        // A game with no storefront at all has no actions row yet — give it one.
        const hero = body.querySelector(".hero") || body.firstElementChild;
        if (hero) hero.insertAdjacentHTML("beforeend", `<div class="hero-actions">${html}</div>`);
      }
    }
  }
  // The Pick card is drawn before /api/romm has answered, so without this the pick you're
  // staring at is the one game that never gets a Play button.
  const picked = typeof pickState !== "undefined" && pickState ? pickState.picked : null;
  const acts = document.querySelector(".pick-actions");     // lives in #picker, not #pick
  if (picked && acts && !acts.querySelector(".btn.play")) {
    const html = rommHtml(picked);
    if (html) acts.insertAdjacentHTML("beforeend", html);
  }
}

function launchHtml(row) {
  // A wishlist-only row's store links live in its own deal block (View on Steam +
  // Buy on the best-deal vendor), so the hero doesn't add a duplicate here.
  if (row._wlOnly) return "";
  const t = launchTarget(row);
  if (!t) return rommHtml(row);
  const external = /^https?:/.test(t.href);
  const store = t.kind === "launch"
    ? `<a class="btn launch" href="${escapeHtml(t.href)}">${escapeHtml(t.label)}</a>`
    : `<a class="btn ghost" href="${escapeHtml(t.href)}"${external ? ' target="_blank" rel="noopener"' : ""}>${escapeHtml(t.label)}${external ? " ↗" : ""}</a>`;
  return rommHtml(row) + store;      // playing it beats buying it
}
