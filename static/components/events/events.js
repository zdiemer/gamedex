"use strict";

// UI components for events.js. Feature state and orchestration remain in that module.

/* The pill that says you are not looking at today. It sits on top of everything, on every
   tab, because the failure mode this guards against is forgetting the override is on and
   filing a bug against December. */
function evPreviewChrome() {
  let el = document.getElementById("evPreviewPill");
  if (!EV_FAKE) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "evPreviewPill";
    el.className = "ev-preview-pill";
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>Previewing <b>${escapeHtml(EV_FAKE)}</b></span>
    <button id="evPreviewToday" class="btn ghost sm">Back to today</button>`;
  const b = document.getElementById("evPreviewToday");
  if (b) b.onclick = () => evSetPreview(null);
}

const evHomeBannerHtml = () => { const ev = evTopBanner(); return ev ? ev.bannerHtml() : ""; };

// Home repaints one section at a time (patchHomeRecs), so coming back from an event page
// has to refresh the banner without a full render. Replaces whichever banner is up with
// whichever banner should be up — they may not be the same event, after a preview jump.
function evPatchBanner() {
  const cur = document.querySelector("#home .ev-banner, #home .spk-banner");
  if (!cur) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = evHomeBannerHtml();
  const next = tmp.firstElementChild;
  if (!next) { cur.remove(); return; }
  cur.replaceWith(next);
  evWireBanner(next.parentNode || document);
}

/* ---- the shared banner -----------------------------------------------------
   Same construction as .spk-banner: the decoration is real markup rather than a background
   image, because the brief is that the icons LIFT on hover and you cannot lift part of a
   background. Each piece carries its own --x/--y/--r/--lift/--d, so the stylesheet holds
   one rule and the arrangement lives in the event file where you can read it at a glance. */
const evDecoHtml = (list) => (list || []).map((o) =>
  `<span class="ev-deco${o.cls ? " " + o.cls : ""}${o.still ? "" : " drift"}" aria-hidden="true"
     style="--x:${o.x}%;--y:${o.y}%;--r:${o.r || 0}deg;--lift:${o.lift || 10}px;--d:${o.d || 0}ms;--o:${o.o == null ? .9 : o.o}"
   >${icon(o.i, o.s)}</span>`).join("");

function evMeterHtml(m) {
  if (!m) return "";
  const bar = m.pct == null ? ""
    : `<span class="ev-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, m.pct))}%"></span></span>`;
  return bar + (m.text ? `<span class="ev-meter-t">${escapeHtml(m.text)}</span>` : "");
}

function evBannerHtml(ev) {
  const m = ev.meter ? ev.meter() : null;
  return `<section class="ev-banner" data-ev="${ev.id}" style="${ev.skin}" role="button" tabindex="0"
      aria-label="${escapeHtml(evName(ev))}: ${escapeHtml(ev.blurb || ev.structure)}">
    <div class="ev-deco-wrap">${evDecoHtml(ev.deco)}</div>
    <div class="ev-banner-in">
      <span class="h-eyebrow ev-eyebrow">${escapeHtml(ev.eyebrow ? ev.eyebrow() : "Seasonal event")}</span>
      <h2 class="ev-title">${escapeHtml(evName(ev))}</h2>
      <p class="ev-pitch">${escapeHtml(ev.pitch ? ev.pitch() : "")}</p>
      <span class="ev-cta">${escapeHtml(ev.cta)} →</span>
      ${evMeterHtml(m)}
    </div>
  </section>`;
}

// The event page's own header. Same skin, same decoration, wider — so arriving from the
// banner feels like the banner opened rather than like you left it behind.
function evHeroHtml(ev, opts = {}) {
  const m = ev.meter ? ev.meter() : null;
  const st = evPhase(ev);
  const off = !evBannerOn(ev) && ev.window
    ? `<p class="ev-off">${escapeHtml(ev.offSeason || `${ev.name} runs ${evWindowText(ev)}. You're early, or late, but the page is yours to keep.`)}</p>`
    : "";
  return `<section class="ev-hero" style="${ev.skin}">
    <div class="ev-deco-wrap">${evDecoHtml(ev.deco)}</div>
    <div class="ev-hero-in">
      <span class="h-eyebrow ev-eyebrow">${escapeHtml(ev.eyebrow ? ev.eyebrow() : "Seasonal event")}${
        ev.window ? " · " + evYear(ev) : ""}</span>
      <h1 class="ev-title big">${escapeHtml(evName(ev))}</h1>
      <p class="ev-pitch">${escapeHtml(ev.pitch ? ev.pitch() : "")}</p>
      ${off}
      ${m ? `<div class="ev-meter">${evMeterHtml(m)}</div>` : ""}
      ${opts.acts ? `<div class="ev-acts">${opts.acts}</div>` : ""}
      ${opts.note ? `<p class="ev-note">${opts.note}</p>` : ""}
    </div>
  </section>${st.phase === "before" && opts.beforeNote ? `<p class="ev-early">${opts.beforeNote}</p>` : ""}`;
}

function evPickerResultsHtml(used) {
  const q = EVP.q.trim().toLowerCase();
  const src = EVP.all ? evAllGames() : (EVP.pool || []);
  const pool = src.filter((r) => !q || String(r.title || "").toLowerCase().includes(q));
  if (!pool.length) {
    return `<p class="ev-none">${EVP.all ? "Nothing on the sheet by that name."
      : "Nothing in this pool by that name. Tick “any game” to search the whole collection."}</p>`;
  }
  // Best rated first when you haven't typed: the top of a long list should be a
  // recommendation, not wherever the sheet happens to start.
  const rank = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : 0);
  const sorted = q ? pool : pool.slice().sort((a, b) => rank(b) - rank(a));
  const shown = sorted.slice(0, 60);
  const taken = used || new Map();
  const cards = shown.map((r) => posterCardHtml(r, {
    cls: "ev-cand" + (taken.has(evKey(r)) ? " taken" : ""),
    note: taken.has(evKey(r)) ? `<span class="ev-taken">${escapeHtml(String(taken.get(evKey(r))))}</span>` : "",
    attrs: `data-evput="${escapeHtml(evKey(r))}"`,
  })).join("");
  const more = sorted.length - shown.length;
  return `<div class="ev-cands">${cards}</div>` +
    (more > 0 ? `<p class="ev-more">${more.toLocaleString()} more. Keep typing to narrow it down.</p>` : "");
}

function evPickerHtml(used) {
  if (EVP.slot == null) return "";
  return `<div class="ev-picker" id="evPicker">
    <div class="ev-picker-head">
      <b>${escapeHtml(EVP.title)}</b>
      <input id="evQ" class="ev-q" type="search" placeholder="${EVP.all ? "Search the whole collection…" : "Search this pool…"}"
             value="${escapeHtml(EVP.q)}" autocomplete="off">
      <label class="ev-any" title="Ignore the pool and pick from everything on the sheet">
        <input type="checkbox" id="evAny"${EVP.all ? " checked" : ""}> any game
      </label>
      <button class="btn ghost" id="evPickDone">Done</button>
    </div>
    <div id="evResults">${evPickerResultsHtml(used)}</div>
  </div>`;
}

// Wire the picker into a rendered page. `repaint` is the event's own render function.
function evWirePicker(host, repaint, used) {
  host.querySelectorAll("[data-evput]").forEach((el) => {
    el.onclick = () => { if (EVP.onPick) EVP.onPick(el.dataset.evput); };
  });
  const done = document.getElementById("evPickDone");
  if (done) done.onclick = () => evPickerClose(repaint);
  const any = document.getElementById("evAny");
  if (any) any.onchange = () => { EVP.all = any.checked; evRepaintKeepingCaret(repaint); };
  const q = document.getElementById("evQ");
  if (q) {
    q.oninput = () => {
      EVP.q = q.value;
      const res = document.getElementById("evResults");
      if (!res) return;
      res.innerHTML = evPickerResultsHtml(used);
      evWirePicker(res, repaint, used);                 // the cards are new; the input is not
      if (typeof maybeEnrich === "function") maybeEnrich((EVP.all ? evAllGames() : EVP.pool || []).slice(0, 60));
    };
    q.onkeydown = (e) => { if (e.key === "Escape") evPickerClose(repaint); };
  }
}

/* ---- small shared pieces ---------------------------------------------------- */

// One game, as a tile with its cover. Used by ten of the twelve pages, which is why it
// isn't nine slightly different tiles.
function evTileHtml(row, opts = {}) {
  if (!row) return `<span class="ev-tile empty">${opts.emptyText || "Empty"}</span>`;
  const cs = typeof coverSrc === "function" ? coverSrc(ENRICH[row._k], "cover_big") : "";
  const cover = cs
    ? `<img class="ev-cover" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
    : `<span class="ev-cover ph">${icon("i-library", 22)}</span>`;
  return `<button class="ev-tile${opts.cls ? " " + opts.cls : ""}" data-evopen="${escapeHtml(evKey(row))}"
      title="Open ${escapeHtml(String(row.title || ""))}">
    ${cover}
    <span class="ev-tile-t">${escapeHtml(String(row.title || ""))}</span>
    <span class="ev-tile-s">${escapeHtml(opts.sub != null ? opts.sub : String(row.platform || ""))}</span>
  </button>`;
}

/* ---- the preview page (?tab=events) ----------------------------------------
   Twelve events, eight overlapping windows and a banner slot that holds one of them. The
   only way to know what Home does on December 26th is to be there, so this page moves the
   clock and shows the whole board from wherever you put it: which event owns the banner,
   what every banner looks like on that date, and what phase each page thinks it is in. */
function evRenderAdmin() {
  const host = $("#eventsAdmin");
  if (!host) return;
  const d = evNow();
  const top = evTopBanner(d);
  const rows = EV.list.slice().sort((a, b) => b.priority - a.priority).map((ev) => {
    const on = evBannerOn(ev, d);
    const chosen = typeof ev.active !== "function" || ev.active(d);
    const st = evPhase(ev, d);
    const when = ev.window ? `${evDateText(ev.window.from)} → ${evDateText(ev.window.to)}` : "no season";
    const phase = !ev.window ? "always on"
      : st.phase === "before" ? `${st.days}d to go`
      : st.phase === "during" ? (st.day ? `day ${st.day}` : "live") : `${st.days}d past`;
    return `<tr class="${on ? "on" : ""}">
      <td><button class="linkbtn" data-evgo="${ev.id}">${escapeHtml(ev.name)}</button>
        ${top && top.id === ev.id ? `<span class="ev-badge">on Home</span>` : ""}</td>
      <td class="m">${escapeHtml(ev.structure)}</td>
      <td class="m">${escapeHtml(when)}</td>
      <td class="m">${ev.priority}</td>
      <td class="m">${on ? `<span class="ev-yes">${ev.window ? "in season" : "has something"}</span>`
        : `<span class="ev-no">${!chosen ? "not drawn this year" : ev.window ? "off" : "quiet"}</span>`}</td>
      <td class="m">${escapeHtml(phase)}</td>
    </tr>`;
  }).join("");

  // Every banner, at the chosen date, in priority order. Rendering them all is the point:
  // twelve skins that each looked right alone is how a board ends up with three oranges.
  const gallery = EV.list.slice().sort((a, b) => b.priority - a.priority)
    .map((ev) => `<div class="ev-gal-item${evBannerOn(ev, d) ? "" : " off"}">
      <div class="ev-gal-head">
        <b>${escapeHtml(ev.name)}</b>
        <span class="m">${escapeHtml(ev.structure)}</span>
        ${evBannerOn(ev, d) ? "" : `<span class="ev-no">${typeof ev.active === "function" && !ev.active(d)
          ? "not drawn this year" : "out of season"}, shown anyway</span>`}
      </div>
      ${ev.bannerHtml ? ev.bannerHtml() : `<p class="ev-none">No banner.</p>`}
    </div>`).join("");

  host.innerHTML = `
    <div class="ev-admin-wrap">
      <header class="ev-admin-head">
        <span class="h-eyebrow">Seasonal events</span>
        <h1>The board</h1>
        <p class="ev-admin-sub">${EV.list.length} events, one banner slot on Home. Move the date to
          see which of them owns it, and what every page thinks the season is doing.</p>
        <div class="ev-admin-date">
          <label for="evDate">Preview as of</label>
          <input type="date" id="evDate" value="${evISO(d)}">
          <button class="btn ghost" id="evDateToday">Today</button>
          ${EV.list.filter((e) => e.window).slice(0, 12).map((e) =>
            `<button class="btn ghost sm" data-evjump="${e.window.from[0]}-${e.window.from[1]}-${e.id}"
               title="Jump to the middle of ${escapeHtml(e.name)}">${escapeHtml(e.name)}</button>`).join("")}
        </div>
      </header>
      <table class="ev-admin-table">
        <thead><tr><th>Event</th><th>Structure</th><th>Window</th><th>Priority</th><th>State</th><th>Phase</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h2 class="ev-admin-h2">Every banner, on ${escapeHtml(evISO(d))}</h2>
      <div class="ev-gallery">${gallery}</div>
    </div>`;

  host.querySelectorAll("[data-evgo]").forEach((el) => { el.onclick = () => goTab(el.dataset.evgo); });
  const date = document.getElementById("evDate");
  if (date) date.onchange = () => evSetPreview(date.value || null);
  const today = document.getElementById("evDateToday");
  if (today) today.onclick = () => evSetPreview(null);
  host.querySelectorAll("[data-evjump]").forEach((el) => {
    el.onclick = () => {
      const [m, day, id] = el.dataset.evjump.split("-");
      const ev = evById(id);
      // The middle of the core period, not its first day: a page on day one of thirty is
      // the least informative version of itself.
      const c = ev.core || ev.window;
      const mid = new Date(evNow().getFullYear(), +m - 1, +day);
      if (c) {
        const half = Math.floor(evCoreDays(ev) / 2);
        mid.setMonth(c.from[0] - 1, c.from[1]);
        mid.setDate(mid.getDate() + half);
      }
      evSetPreview(evISO(mid));
    };
  });
  evWireBanner(host);
  evPreviewChrome();
}
