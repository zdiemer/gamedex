"use strict";

// UI components for mine.js. Feature state and orchestration remain in that module.

// ---- drawer: pills + stat cells (sync, from the light map) ----------------
function minePillsHtml(key) {
  const pills = [];
  for (const [p, it] of mineEntries(key)) {
    if (!mineOnHomePlatform(key, p)) continue;
    const verb = MINE_PROVIDERS[p].verb;
    if (it.playtimeMin != null && it.playtimeMin > 0
        && !mineCloseToSheet(key, p, it.playtimeMin / 60))
      pills.push(`<span class="mine-pill plat">${escapeHtml(fmtHours(it.playtimeMin / 60))} ${escapeHtml(verb)}</span>`);
    else
      // A store with no playtime (GOG, itch) still owns the game — say so, so the
      // library ownership shows up at all. Same when the clock just agrees with
      // the sheet: keep the ownership, skip the redundant number.
      pills.push(`<span class="mine-pill plat">Owned ${escapeHtml(verb)}</span>`);
    if (it.ach && it.ach.total)
      pills.push(`<span class="mine-pill plat">🏆 ${it.ach.unlocked}/${it.ach.total}</span>`);
    if (it.review)
      pills.push(`<span class="mine-pill plat">${it.review.recommended ? "👍" : "👎"} Reviewed ${escapeHtml(verb)}</span>`);
  }
  return pills.join("");
}

// ---- drawer: the async detail panel ---------------------------------------
async function loadMineDetail(key, el) {
  if (!el || !MINE_ENABLED || !mineEntries(key).length) return;
  if (!MINED[key]) {
    try {
      const r = await fetch("api/mine/detail?key=" + encodeURIComponent(key));
      if (!r.ok) return;
      MINED[key] = (await r.json()).items || {};
    } catch (_) { return; }
  }
  // Same home-platform rule as the pills: the achievement grid, screenshots and
  // store review are the Steam copy's story, not the 360 copy's. The admin fix
  // box stays either way — a cross-family match is exactly the kind that needs
  // repairing, and hiding its only handle would strand it.
  const html = Object.entries(MINED[key])
    .filter(([p]) => MINE_PROVIDERS[p])
    .map(([p, d]) => (mineOnHomePlatform(key, p)
        ? mineAchHtml(p, d) + mineShotsHtml(p, d) + mineReviewHtml(p, d) : "")
      + (IS_ADMIN ? mineFixHtml(p, d, key) : ""))
    .join("");
  el.innerHTML = html;
  wireMineDetail(el, key);
}

function mineAchHtml(provider, d) {
  const list = d.achievements || [];
  if (!list.length) return "";
  const label = MINE_PROVIDERS[provider].label;
  const done = list.filter((a) => a.unlocked);
  const pct = Math.round((100 * done.length) / list.length);
  // Unlocked first, newest unlock leading; the locked tail rarest-last so the
  // next realistic target sits right after your trophies.
  const sorted = [
    ...done.sort((a, b) => String(b.unlockedAt || "").localeCompare(String(a.unlockedAt || ""))),
    ...list.filter((a) => !a.unlocked).sort((a, b) => (b.globalPct || 0) - (a.globalPct || 0)),
  ];
  const grade = (a) => ["bronze", "silver", "gold", "platinum"].includes(a.rarity)
    ? ` t-${a.rarity}` : "";
  const cell = (a) => {
    const icn = a.unlocked ? a.iconUrl : (a.iconLockedUrl || a.iconUrl);
    const meta = [a.unlocked && a.unlockedAt
                    ? `Unlocked ${fmtDate(String(a.unlockedAt).slice(0, 10))}` : (a.unlocked ? "Unlocked" : "Locked"),
                  a.rarity && isNaN(a.rarity) ? a.rarity[0].toUpperCase() + a.rarity.slice(1) : null,
                  a.globalPct != null ? `${a.globalPct}% of players have this` : null]
      .filter(Boolean).join(" · ");
    // A hidden, still-locked achievement keeps its secret — same rule Steam uses.
    const secret = a.hidden && !a.unlocked;
    return `<div class="mine-ach-it${a.unlocked ? " on" : ""}${grade(a)}" tabindex="0"
      data-tip-name="${escapeHtml(secret ? "Hidden achievement" : a.name || "")}"
      data-tip-desc="${escapeHtml(secret ? "Unlock it to find out." : a.description || "")}"
      data-tip-meta="${escapeHtml(meta)}">
      ${icn ? `<img loading="lazy" src="${escapeHtml(cImg(icn))}" alt="" onerror="this.remove()">` : ""}
      ${a.globalPct != null && a.globalPct <= 5 ? `<i class="rare">${a.globalPct}%</i>` : ""}
    </div>`;
  };
  const FOLD = 24;
  const grid = (arr) => `<div class="mine-ach-grid">${arr.map(cell).join("")}</div>`;
  return `<div class="hltb mine-ach">
    <div class="hltb-head">${icon("i-trophy", 15)} ${MINE_PROVIDERS[provider].achWord} · ${done.length} / ${list.length} · ${escapeHtml(label)}</div>
    <div class="mine-ach-track"><div class="mine-ach-bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>
    ${grid(sorted.slice(0, FOLD))}
    ${sorted.length > FOLD
      ? `<details class="mine-ach-more"><summary>All ${sorted.length}</summary>${grid(sorted.slice(FOLD))}</details>`
      : ""}
  </div>`;
}

function mineShotsHtml(provider, d) {
  const shots = d.screenshots || [];
  if (!shots.length) return "";
  return `<div class="hltb mine-shots-sect">
    <div class="hltb-head">${icon("i-grid", 15)} Your screenshots <span class="muted">${shots.length}</span></div>
    <div class="mine-shots" data-mineshots="${escapeHtml(provider)}">
      ${shots.map((s, i) => `<img loading="lazy" src="${escapeHtml(s.url)}" alt=""
        onerror="this.style.opacity=.25" data-shot="${i}" title="${escapeHtml([s.caption, s.takenAt ? fmtDate(String(s.takenAt).slice(0, 10)) : null].filter(Boolean).join(" · "))}">`).join("")}
    </div>
  </div>`;
}

function mineReviewHtml(provider, d) {
  const r = d.review;
  if (!r || (!r.text && r.recommended == null)) return "";
  const label = MINE_PROVIDERS[provider].label;
  const verdict = r.recommended == null ? ""
    : `<b class="${r.recommended ? "rating-good" : "rating-bad"}">${r.recommended ? "👍 Recommended" : "👎 Not recommended"}</b>`;
  const facts = [r.hoursAtReview != null ? `${r.hoursAtReview} hrs at review` : null,
                 r.postedAt || null].filter(Boolean).join(" · ");
  return `<div class="hltb mine-rev">
    <div class="hltb-head">${icon("i-review", 15)} Your ${escapeHtml(label)} review</div>
    <div class="mine-rev-verdict">${verdict}${facts ? ` <span class="muted">${escapeHtml(facts)}</span>` : ""}</div>
    ${r.text ? `<blockquote class="mine-review">${escapeHtml(r.text)}</blockquote>` : ""}
    ${r.url ? `<a class="hltb-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">On ${escapeHtml(label)} ↗</a>` : ""}
  </div>`;
}

// Admin: repoint which library app this sheet row is matched to (the platform
// twin of hero.js's "Fix mapping" rows).
function mineFixHtml(provider, d, key) {
  const label = MINE_PROVIDERS[provider].label;
  return `<details class="map-menu mine-fix" data-minefix="${escapeHtml(provider)}">
    <summary>${icon("i-edit", 13)} Fix ${escapeHtml(label)} library match</summary>
    <div class="map-src"><label>${escapeHtml(label)} app id (currently ${escapeHtml(String(d.appId))})</label>
      <div class="map-row"><input type="text" value="${escapeHtml(String(d.appId))}" data-fix-input>
        <button class="btn" data-fix-pin>Pin</button>
        <button class="linkbtn" data-fix-auto title="Re-run auto-matching">Auto</button>
        <button class="linkbtn danger" data-fix-remove title="Pin as no match">Remove</button>
      </div></div>
  </details>`;
}

// One floating tooltip for every achievement grid — built lazily, repositioned
// per cell, clamped to the viewport. The native title attr was doing this job
// with a 1s delay and no typography.
function achTip() {
  let t = document.getElementById("achTip");
  if (!t) {
    t = document.createElement("div");
    t.id = "achTip";
    t.hidden = true;
    document.body.appendChild(t);
    // The tip is viewport-positioned, so once the page (or the drawer, or any
    // ancestor) scrolls it detaches from its cell and floats — dismiss instead.
    // Capture phase because scroll events don't bubble out of inner scrollers.
    document.addEventListener("scroll", achTipHide, { capture: true, passive: true });
  }
  return t;
}

function achTipShow(cell) {
  const t = achTip();
  const name = cell.dataset.tipName, desc = cell.dataset.tipDesc, meta = cell.dataset.tipMeta;
  if (!name && !desc) return;
  t.innerHTML = `${name ? `<b>${escapeHtml(name)}</b>` : ""}` +
    `${desc ? `<div class="at-desc">${escapeHtml(desc)}</div>` : ""}` +
    `${meta ? `<div class="at-meta">${escapeHtml(meta)}</div>` : ""}`;
  t.hidden = false;
  const r = cell.getBoundingClientRect();
  const tw = t.offsetWidth, th = t.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
  let y = r.top - th - 8;
  t.classList.toggle("below", y < 8);
  if (y < 8) y = r.bottom + 8;
  t.style.left = `${Math.round(x)}px`;
  t.style.top = `${Math.round(y)}px`;
}

// ---- the admin dialog: Linked platforms ------------------------------------
async function openPlatformsDialog() {
  let state = null;
  try {
    const r = await fetch("api/platforms");
    if (r.ok) state = (await r.json()).providers;
  } catch (_) { /* rendered below as unreachable */ }
  const host = openAuthModal(`
      <h3>Linked platforms</h3>
      <div class="ce-sub">Personal libraries, synced in the background</div>
      <div class="plat-cards" id="platCards">${state ? platCardsHtml(state) : "<p class='auth-err'>Couldn't reach the server.</p>"}</div>`);
  host.classList.add("plat-wide");     // a roomier modal — seven providers need it
  wirePlatCards(host);
  // Live counts while a sync runs: repoll while the dialog is up, stop the
  // moment it closes (closeAuthModal removes the host from the DOM).
  const tick = setInterval(async () => {
    if (!host.isConnected) { clearInterval(tick); return; }
    // Never clobber someone mid-typing: skip the refresh while a credential
    // form has focus or content.
    const active = document.activeElement;
    if (active && host.contains(active) && active.matches("input, button")) return;
    if ([...host.querySelectorAll(".plat-form input")].some((i) => i.value)) return;
    try {
      const r = await fetch("api/platforms");
      if (!r.ok) return;
      const providers = (await r.json()).providers;
      const cards = host.querySelector("#platCards");
      if (!cards || !host.isConnected) return;
      // Preserve which sections the user has expanded — a blind re-render resets
      // every <details> to its default and collapses whatever they just opened.
      const openState = {};
      cards.querySelectorAll(".plat-card[data-plat]").forEach((d) => { openState[d.dataset.plat] = d.open; });
      cards.innerHTML = platCardsHtml(providers);
      cards.querySelectorAll(".plat-card[data-plat]").forEach((d) => {
        if (d.dataset.plat in openState) d.open = openState[d.dataset.plat];
      });
      wirePlatCards(host);
    } catch (_) { /* next tick */ }
  }, 3000);
}

// Each provider is a collapsible section — with seven of them, a flat list of
// full cards is a mile-long thin modal. The summary carries the label + a status
// chip; expanding shows the link form (unlinked) or the stats + actions (linked).
// Linked providers open by default so their state is visible at a glance; the
// unlinked forms stay tucked away until you want one.
function platCardsHtml(state) {
  return Object.entries(MINE_PROVIDERS).map(([p, def]) => {
    const s = state[p] || { linked: false, supported: false };
    const chip = !s.supported ? `<span class="plat-chip muted">coming later</span>`
      : s.linked
        ? (s.status === "error" ? `<span class="plat-chip err">needs attention</span>`
           : s.syncing ? `<span class="plat-chip live">syncing…</span>`
           : `<span class="plat-chip ok">${escapeHtml(s.displayName || "linked")}</span>`)
        : `<span class="plat-chip">not linked</span>`;
    const open = s.linked ? " open" : "";

    let bodyInner;
    if (!s.supported) {
      bodyInner = `<p class="muted">Support for ${escapeHtml(def.label)} isn't wired up.</p>`;
    } else if (!s.linked) {
      const form = PLAT_FORMS[p];
      const fields = (form ? form.fields : []).map((f) =>
        `<label>${escapeHtml(f.label)}<input type="text" data-cred="${f.k}" autocomplete="off"
          name="${p}-${f.k}" spellcheck="false" placeholder="${escapeHtml(f.ph)}"${
          f.mode ? ` inputmode="${f.mode}"` : ""}></label>`).join("");
      bodyInner = `<form class="auth-form plat-form">
          ${form && form.hintHtml ? `<div class="plat-hint">${form.hintHtml}</div>` : ""}
          ${fields}
          <p class="auth-err" data-plat-err hidden></p>
          <div class="ce-acts"><span></span><div class="ce-right">
            <button class="sh-btn primary" type="submit">Link</button>
          </div></div>
        </form>`;
    } else {
      const c = s.counts || {};
      const stats = [
        c.games != null ? `${c.games.toLocaleString()} games (${c.matched} matched)` : null,
        c.achievements ? `${c.achievementsUnlocked}/${c.achievements} achievements` : null,
        c.screenshots ? `${c.screenshots} screenshots` : null,
        c.wishlist ? `${c.wishlist} wishlisted` : null,
        c.reviews ? `${c.reviews} reviews` : null,
      ].filter(Boolean).join(" · ");
      const when = s.lastSync ? new Date(s.lastSync).toLocaleString(undefined,
        { dateStyle: "medium", timeStyle: "short" }) : "never";
      const who = s.displayName && s.profileUrl
        ? `<div class="plat-stats"><a class="plat-who" href="${escapeHtml(s.profileUrl)}" target="_blank" rel="noopener">${escapeHtml(s.displayName)} ↗</a></div>` : "";
      bodyInner = `${who}
        <div class="plat-stats muted">${escapeHtml(stats || "nothing synced yet")}</div>
        <div class="plat-stats muted">Last sync: ${escapeHtml(when)}<b data-plat-stage>${s.syncing ? ` · syncing (${escapeHtml(s.syncing)})…` : ""}</b></div>
        ${s.status === "error" && s.error ? `<p class="auth-err">${escapeHtml(s.error)}</p>` : ""}
        <div class="ce-acts"><span></span><div class="ce-right">
          <button class="sh-btn" data-plat-sync type="button">Sync now</button>
          <button class="sh-btn danger" data-plat-unlink type="button">Unlink</button>
        </div></div>`;
    }
    return `<details class="plat-card" data-plat="${p}"${open}>
      <summary class="plat-head"><b>${escapeHtml(def.label)}</b>${chip}</summary>
      <div class="plat-body">${bodyInner}</div>
    </details>`;
  }).join("");
}
