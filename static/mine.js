"use strict";

/* Personal platform data: MY hours, MY achievements, MY screenshots, MY review.

   Everything else in the drawer is about the game; this is about what happened
   between me and it, mirrored from the linked platform accounts (Steam first;
   PSN/Xbox/Nintendo later) by platform_sync.py on the server.

   Two caches, same shape as enrich.js keeps for every other source:
     MINE   matchKey -> light map from /api/mine/all (playtime, ach counts, the
            owned appid) — loaded once at boot, read synchronously by the drawer
            pills, the hero stat strip and launch.js.
     MINED  matchKey -> full detail from /api/mine/detail (the achievement grid,
            the screenshots, the review) — fetched when a drawer opens.

   Also the admin "Linked platforms" dialog (provider cards, credentials,
   sync-now), reached from the account menu in chrome.js. */

let MINE = {};                    // matchKey -> {steam: {...}, _flags: {...}}
const MINED = {};                 // matchKey -> /api/mine/detail items
let MINE_ENABLED = false;

// The one provider pass 1 ships. Later providers add themselves here and
// everything below — pills, panels, badges — picks them up.
const MINE_PROVIDERS = {
  steam: { label: "Steam", verb: "on Steam", achWord: "Achievements" },
  gog: { label: "GOG", verb: "on GOG", achWord: "Achievements" },
  epic: { label: "Epic Games", verb: "on Epic", achWord: "Achievements" },
  itch: { label: "itch.io", verb: "on itch.io", achWord: "Achievements" },
  psn: { label: "PlayStation", verb: "on PlayStation", achWord: "Trophies" },
  xbox: { label: "Xbox", verb: "on Xbox", achWord: "Achievements" },
  nintendo: { label: "Nintendo", verb: "on Switch", achWord: "Achievements" },
};

// What linking each provider asks for. type=text everywhere — browsers autofill
// the site's own saved login into any password field, no matter what
// autocomplete says, which is how a box arrives pre-filled with bullets.
const PLAT_FORMS = {
  steam: {
    // hintHtml is trusted, author-written markup (NOT user data) — the only
    // place in a provider card that isn't escaped.
    hintHtml: `Get a key at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener">steamcommunity.com/dev/apikey ↗</a>;
      your SteamID64 is the number in your profile URL (<a href="https://steamid.io" target="_blank" rel="noopener">steamid.io ↗</a> resolves a vanity name).`,
    fields: [
      { k: "apiKey", label: "Web API key", ph: "from steamcommunity.com/dev/apikey" },
      { k: "steamId", label: "SteamID64", ph: "7656119…", mode: "numeric" },
    ],
  },
  psn: {
    hintHtml: `<ol class="plat-steps">
      <li><a href="https://www.playstation.com" target="_blank" rel="noopener">Sign in to playstation.com ↗</a> with your PSN account.</li>
      <li>In the same browser, open <a href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noopener">ca.account.sony.com/api/v1/ssocookie ↗</a>.</li>
      <li>Copy the <code>npsso</code> value from the JSON it returns and paste it below.</li>
    </ol><span class="muted">The token lasts ~2 months; you'll be asked for a fresh one when it expires.</span>`,
    fields: [{ k: "npsso", label: "NPSSO token", ph: "64-character token" }],
  },
  xbox: {
    hintHtml: `<ol class="plat-steps">
      <li><a href="https://xbl.io/login" target="_blank" rel="noopener">Sign in to OpenXBL ↗</a> with the Microsoft account whose Xbox library you want.</li>
      <li>Copy your key from <a href="https://xbl.io/dashboard/keys" target="_blank" rel="noopener">xbl.io/dashboard/keys ↗</a> and paste it below.</li>
    </ol><span class="muted">Free tier is 150 requests/hour, plenty for the nightly trickle this does.</span>`,
    fields: [{ k: "apiKey", label: "OpenXBL API key", ph: "from xbl.io/dashboard/keys" }],
  },
  gog: {
    hintHtml: `Brings your DRM-free library + wishlist (GOG doesn't expose playtime).
      <ol class="plat-steps">
        <li><a href="https://auth.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2" target="_blank" rel="noopener">Log in to GOG ↗</a>.</li>
        <li>You'll land on a blank page. Copy its <b>whole URL</b> (it has <code>?code=…</code>) and paste it below.</li>
      </ol>`,
    fields: [{ k: "code", label: "Login code (or the redirect URL)", ph: "…on_login_success?code=…" }],
  },
  epic: {
    hintHtml: `Brings your Epic library + real playtime (+ wishlist where available).
      <ol class="plat-steps">
        <li>Open <a href="https://legendary.gl/epiclogin" target="_blank" rel="noopener">legendary.gl/epiclogin ↗</a> and sign in
          (it handles Epic's SSO; the raw redirect link returns a null code).</li>
        <li>Copy the <code>authorizationCode</code> value from the JSON it shows and paste it below.</li>
      </ol><span class="muted">The code is single-use; grab a fresh one if it's rejected.</span>`,
    fields: [{ k: "code", label: "Authorization code", ph: "32-character code" }],
  },
  itch: {
    hintHtml: `Brings the games you own on itch.io.
      <ol class="plat-steps">
        <li>Make a key at <a href="https://itch.io/user/settings/api-keys" target="_blank" rel="noopener">itch.io/user/settings/api-keys ↗</a>.</li>
        <li>Paste it below.</li>
      </ol>`,
    fields: [{ k: "apiKey", label: "itch.io API key", ph: "from itch.io/user/settings/api-keys" }],
  },
  nintendo: {
    hintHtml: `Nintendo only exposes playtime, through the Parental Controls app;
      so this brings hours per game, nothing else.
      <ol class="plat-steps">
        <li>Get a Parental-Controls <b>session token</b> for your Nintendo account.
          The <a href="https://github.com/samuelthomas2774/nxapi" target="_blank" rel="noopener">nxapi tool ↗</a>
          (<code>nxapi pctl auth</code>) is the usual way, or any guide for the
          "moonlight" / Parental Controls session token.</li>
        <li>Paste it below. It's long-lived; you'll only redo this if it's revoked.</li>
      </ol>`,
    fields: [{ k: "sessionToken", label: "Session token", ph: "eyJ… (Parental Controls)" }],
  },
};
const mineEntries = (key) => Object.entries(MINE[key] || {})
  .filter(([p]) => MINE_PROVIDERS[p]);

async function loadMine() {
  try {
    const r = await fetch("api/mine/all");
    if (!r.ok) return;
    const j = await r.json();
    MINE_ENABLED = !!j.enabled;
    MINE = j.items || {};
  } catch (_) { /* personal data is a layer, never a dependency */ }
}

// The appid of the copy I actually own — beats IGDB's guess in launch.js.
function mineSteamAppId(key) {
  const s = (MINE[key] || {}).steam;
  return s ? s.appId : null;
}

/* Which sheet platforms a provider's clock can speak for — the same families the
   server-side matcher uses (platform_sync._PLATFORM_FAMILY). A completion logged
   on PS5 says nothing about stray Steam hours for the same title, so hours are
   only compared to the sheet when the row's platform belongs to the provider's
   family. Shared with the health checks in health.js. */
const _MINE_PC = ["pc", "mac os", "linux"];
const MINE_PLAT_FAMILY = {
  steam: _MINE_PC, gog: _MINE_PC, epic: _MINE_PC, itch: _MINE_PC,
  psn: ["playstation", "playstation 2", "playstation 3", "playstation 4",
        "playstation 5", "playstation network", "playstation portable",
        "playstation vita"],
  // PC included: Game Pass PC / Play Anywhere / GFWL live in the same Xbox
  // account, and the server-side matcher hangs them on PC rows.
  xbox: ["xbox", "xbox 360", "xbox one", "xbox series x|s", ..._MINE_PC],
  nintendo: ["nintendo switch", "nintendo switch 2", "nintendo wii u",
             "nintendo 3ds"],
};

// key → games-sheet row, memoized per rows array so a data reload rebuilds it.
let _mineRowIdx = null, _mineRowSrc = null;
function mineRowOf(key) {
  const rows = (((typeof DATA !== "undefined" && DATA ? DATA.sheets : {}) || {}).games || {}).rows || [];
  if (rows !== _mineRowSrc) {
    _mineRowSrc = rows;
    _mineRowIdx = new Map(rows.map((r) => [r._k, r]));
  }
  return _mineRowIdx.get(key);
}

/* A provider's story belongs on the copy it happened on — the Steam clock on
   the PC row, trophies on the PlayStation row. The matcher ties one app to
   every row sharing the IGDB id, so a combined card's PS5 copy arrives
   carrying Steam hours; the glance surfaces (pills, stat cells) skip those.
   A row the sheet can't resolve keeps everything. */
function mineOnHomePlatform(key, provider) {
  const fam = MINE_PLAT_FAMILY[provider];
  const r = mineRowOf(key);
  const plat = r && String(r.platform || "").toLowerCase();
  if (!fam || !plat) return true;
  return fam.includes(plat);
}

/* The sheet's own Completion Time for this key, when this provider's family
   covers the row's platform; null otherwise. */
function mineSheetHours(key, provider) {
  const r = mineRowOf(key);
  if (!r || !r.completionTime) return null;
  return mineOnHomePlatform(key, provider) ? r.completionTime : null;
}

// Close = the platform's clock is retelling the sheet's own number — within 20%
// or an hour, whichever is wider. The drawer drops the hours then; agreement is
// noise, only disagreement is worth a pill.
function mineCloseToSheet(key, provider, hours) {
  const sheet = mineSheetHours(key, provider);
  return sheet != null && Math.abs(hours - sheet) <= Math.max(1, sheet * 0.2);
}

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

function mineStatCells(key) {
  const cells = [];
  for (const [p, it] of mineEntries(key)) {
    if (!mineOnHomePlatform(key, p)) continue;
    if (it.playtimeMin != null && it.playtimeMin > 0
        && !mineCloseToSheet(key, p, it.playtimeMin / 60))
      cells.push([fmtHours(it.playtimeMin / 60), `Played (${MINE_PROVIDERS[p].label})`, ""]);
  }
  return cells;
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
function achTipHide() { achTip().hidden = true; }

function wireMineDetail(el, key) {
  el.querySelectorAll(".mine-ach-grid").forEach((grid) => {
    grid.addEventListener("mouseover", (e) => {
      const cell = e.target.closest(".mine-ach-it");
      if (cell) achTipShow(cell);
    });
    grid.addEventListener("mouseout", (e) => {
      if (e.target.closest(".mine-ach-it")) achTipHide();
    });
    grid.addEventListener("focusin", (e) => {
      const cell = e.target.closest(".mine-ach-it");
      if (cell) achTipShow(cell);
    });
    grid.addEventListener("focusout", achTipHide);
  });
  // Personal screenshots reuse the one lightbox (see panels.js openShotSet).
  el.querySelectorAll("[data-mineshots]").forEach((strip) => {
    const p = strip.dataset.mineshots;
    const shots = ((MINED[key] || {})[p] || {}).screenshots || [];
    strip.querySelectorAll("img[data-shot]").forEach((img) => {
      img.onclick = () => openShotSet(shots.map((s) => ({ url: s.url })), +img.dataset.shot);
    });
  });
  el.querySelectorAll("[data-minefix]").forEach((box) => {
    const provider = box.dataset.minefix;
    const cur = ((MINED[key] || {})[provider] || {}).appId;
    const input = box.querySelector("[data-fix-input]");
    const post = async (body) => {
      try {
        const r = await fetch(`api/platforms/${provider}/match`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) return false;
        delete MINED[key];
        await loadMine();
        loadMineDetail(key, el);
        return true;
      } catch (_) { return false; }
    };
    box.querySelector("[data-fix-pin]").onclick = () => {
      const v = input.value.trim();
      if (v) post({ appId: v, key });
    };
    box.querySelector("[data-fix-auto]").onclick = () => post({ appId: String(cur) });
    box.querySelector("[data-fix-remove]").onclick = () => post({ appId: String(cur), remove: true });
  });
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

function wirePlatCards(host) {
  host.querySelectorAll(".plat-card[data-plat]").forEach((card) => {
    const p = card.dataset.plat;
    const form = card.querySelector(".plat-form");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = card.querySelector("[data-plat-err]");
      err.hidden = true;
      const credentials = {};
      form.querySelectorAll("[data-cred]").forEach((i) => credentials[i.dataset.cred] = i.value.trim());
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true; btn.textContent = "Checking…";
      try {
        const r = await fetch(`api/platforms/${p}/link`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentials }),
        });
        if (r.ok) {
          showToast(`${MINE_PROVIDERS[p].label} linked, first sync started`, "i-check");
          openPlatformsDialog();
          return;
        }
        const j = await r.json().catch(() => ({}));
        err.textContent = j.detail || "Couldn't link the account.";
        err.hidden = false;
      } catch (_) { err.textContent = "Couldn't reach the server."; err.hidden = false; }
      btn.disabled = false; btn.textContent = "Link";
    });
    const sync = card.querySelector("[data-plat-sync]");
    if (sync) sync.onclick = async () => {
      sync.disabled = true;
      sync.textContent = "Syncing…";
      // Reflect the running state on the card at once, then keep it visibly
      // "syncing" and repoll fast until the worker reports a stage (or, for a
      // quick provider that finishes between polls, until a refresh comes back
      // not-busy) — so the click always produces something to see.
      card.classList.add("syncing");
      try { await fetch(`api/platforms/${p}/sync`, { method: "POST" }); } catch (_) {}
      showToast(`${MINE_PROVIDERS[p].label}: sync started`);
      let ticks = 0;
      const poll = setInterval(async () => {
        if (!card.isConnected || ++ticks > 30) { clearInterval(poll); return; }
        try {
          const r = await fetch("api/platforms");
          if (!r.ok) return;
          const s = ((await r.json()).providers || {})[p] || {};
          const label = card.querySelector("[data-plat-stage]");
          if (label) label.textContent = s.syncing ? ` · syncing (${s.syncing})…` : "";
          if (!s.syncing && ticks > 1) {   // finished — refresh counts, stop
            clearInterval(poll);
            openPlatformsDialog();
          }
        } catch (_) { /* next tick */ }
      }, 1500);
    };
    const unlink = card.querySelector("[data-plat-unlink]");
    if (unlink) unlink.onclick = async () => {
      if (!(await uiConfirm({ title: "Unlink account", body: `Unlink ${MINE_PROVIDERS[p].label}? Synced data stays until you purge it.`, ok: "Unlink", danger: true }))) return;
      try { await fetch(`api/platforms/${p}/link`, { method: "DELETE" }); } catch (_) {}
      openPlatformsDialog();
    };
  });
}
