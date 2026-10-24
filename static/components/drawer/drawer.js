"use strict";

// UI components for drawer.js. Feature state and orchestration remain in that module.

// Value cell, made a clickable filter link for facetable text/year columns.
function detailValue(c, v) {
  const facetable = c.facet && (c.type === "text" || c.type === "year");
  const cell = fmtCell(v, c.type);
  if (facetable) return `<a class="facet-link" data-fk="${c.key}" data-fv="${escapeHtml(String(v))}" title="Filter by ${escapeHtml(c.label)}">${cell}</a>`;
  return cell;
}

function mineSectionHtml(row) {
  if (!row._k) return "";
  const h = historyOf(row);
  // A combined card's _k is just the LEAD member's key, so the platform pills and
  // stat cells here would show one copy's Steam hours as if they were the group's.
  // Platform-specific meta belongs on the per-platform copy cards ("Your copies" →
  // click through); the group keeps the sheet-level history, which historyOf and
  // groupRow already aggregate properly.
  const grouped = !!(row._members && row._members.length > 1);

  const pills = [];
  if (h.beaten) pills.push(`<span class="mine-pill done">✓ Beaten</span>`);
  else if (h.status) pills.push(`<span class="mine-pill live">${escapeHtml(h.status)}${
    h.progress != null ? ` · ${Math.round(h.progress * 100)}% done` : ""}</span>`);
  if (h.owned) {
    const own = ["Owned", h.format, h.condition].filter(Boolean).join(" · ");
    pills.push(`<span class="mine-pill">${escapeHtml(own)}</span>`);
  }
  if (h.priority) pills.push(`<span class="mine-pill">Priority ${escapeHtml(String(h.priority))}</span>`);
  if (h.emulated) pills.push(`<span class="mine-pill">Emulated</span>`);
  if (h.steamDeck) pills.push(`<span class="mine-pill">Steam Deck</span>`);
  // What the linked platform accounts know: real hours, achievement counts,
  // whether I reviewed it there (see mine.js).
  if (!grouped && typeof minePillsHtml === "function") {
    const pp = minePillsHtml(row._k);
    if (pp) pills.push(pp);
  }

  const stats = [];
  if (h.rating != null)
    stats.push([`${Math.round(h.rating * 100)}`, "Your rating", ratingClass(h.rating)]);
  if (h.playTime != null) stats.push([fmtHours(h.playTime), "Time played", ""]);
  if (!grouped && typeof mineStatCells === "function") stats.push(...mineStatCells(row._k));
  if (h.price != null) stats.push([`$${Number(h.price).toFixed(2)}`, "Paid", ""]);

  // The shape of the play-through. Only the beats that happened, in the order they
  // actually happened — NOT the order I listed them in: a game bought years before it was
  // logged puts Bought before Added, and hardcoding the sequence drew that backwards.
  // Events landing on the same day share one point rather than stacking two dots on top
  // of each other ("Added & Bought" when you logged it the day you bought it).
  const byDay = new Map();
  for (const [label, v] of [["Added", h.added], ["Bought", h.purchased],
                            ["Started", h.started], ["Completed", h.finished]]) {
    if (!v) continue;
    const day = String(v).slice(0, 10);              // ISO day — sorts chronologically as text
    if (!byDay.has(day)) byDay.set(day, { v, labels: [] });
    byDay.get(day).labels.push(label);               // within a day, keep the natural order
  }
  const track = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, e]) => `<li><b>${escapeHtml(fmtDate(e.v))}</b><span>${e.labels.join(" & ")}</span></li>`);

  const review = h.review
    ? `<blockquote class="mine-review">${escapeHtml(String(h.review))}</blockquote>` : "";
  // Only show the All Games note when it isn't just an echo of the review.
  const note = h.note && String(h.note).trim() !== String(h.review || "").trim()
    ? `<div class="mine-note"><span class="k">Note</span>${escapeHtml(String(h.note))}</div>` : "";

  if (!pills.length && !stats.length && !track.length && !review && !note) return "";
  return `<div class="mine-sect">
    <h3>${icon("i-star", 15)} Your history with this game</h3>
    ${pills.length ? `<div class="mine-pills">${pills.join("")}</div>` : ""}
    ${stats.length ? `<div class="hero-stats mine-stats">${stats.map(([v, l, cls]) =>
      `<div class="hero-stat"><b class="${cls}">${escapeHtml(String(v))}</b><span>${escapeHtml(l)}</span></div>`).join("")}</div>` : ""}
    ${track.length ? `<ol class="mine-track">${track.join("")}</ol>` : ""}
    ${review}${note}
  </div>`;
}

function openDrawer(row, sheetKey, keepStack, returnTo) {
  tourStop();                 // not just stopPreview: leave the tour armed and it would
  stopPreview();              // start a video behind the open drawer 12s later
  // A new game (or navigation within the drawer) retires the previous game's soundtrack
  // player — the dock lives on #drawer, which survives the body rebuild, so it must be
  // torn down explicitly or it would play on over the wrong game.
  if (typeof stopSoundtrack === "function") stopSoundtrack();
  tourLast = null;
  if (!keepStack) {
    drawerStack = [];                       // a fresh open starts a fresh history
    drawerReturn = returnTo || null;
  }
  applyCoverAccent(row);
  drawerSheet = sheetKey || (SPECIAL_TABS.includes(activeTab) ? "games" : activeTab);
  const cols = (DATA.sheets[drawerSheet] || DATA.sheets.games).columns;
  const titleCol = cols[0];
  const body = $("#drawerBody");
  const titleText = escapeHtml(String(row[titleCol.key] ?? "Untitled"));
  let html = heroHtml(row, titleText);
  // Wishlist deal block (price line + View-on-Steam / Buy-on-vendor chips) sits
  // right under the hero — it IS the point of a wishlist drawer.
  if (typeof wishlistDealHtml === "function") html += wishlistDealHtml(row);
  // Recommend block (predicted score, why, dismiss) — "" for every non-rec row.
  if (typeof recsDrawerHtml === "function") html += recsDrawerHtml(row);
  // Translation Watch block (translator, version, and the links out to the sites that
  // host the patch) — "" for every row that isn't from the feed.
  if (typeof twDrawerHtml === "function") html += twDrawerHtml(row);
  // A wishlist-only row has no match-key record, but if it matched an IGDB id we
  // can still load its full detail (summary, screenshots, tags) by that id.
  const wlDetail = row._wlOnly && row._igdbId;
  if (ENRICH_ENABLED && row._k && (!row._wlOnly || wlDetail)) html += `<div id="igdbDetail" class="igdb-detail"></div>`;

  // Box art override — same manual upload as the shelf, so a game's cover can be fixed
  // (or supplied outright) from any detail card. Offered for every real sheet row, not
  // just owned physical ones: a game IGDB never matched has no cover at all, and this is
  // the only way to give it one. Grouped collection cards have no single row to attach to.
  if (IS_ADMIN && row._k && !row._collection && !row._wlOnly) html += `<button class="sh-btn drawer-art" id="drawerArt">Manage box art</button>`;

  // Quick log — status, rating, hours, owned/finished. Staged on the server and
  // overlaid onto the sheet (see edits.js); "" for the public and for every row
  // that isn't a single Games-sheet copy.
  if (typeof editsQuickHtml === "function") html += editsQuickHtml(row);

  /* Your own history with the game was buried in the "Raw data" disclosure,
     alongside File Size and MAME Romset — and it's the most personal thing on the
     card: what you paid, when you started it, whether you finished, what you
     thought. It gets its own section now; the rest stays behind the disclosure. */
  const MINE = MINE_KEYS[drawerSheet] || MINE_KEYS.games;
  const cell = (c, v) => {
    const isNotes = c.type === "text" && String(v).length > 140;
    return isNotes
      ? `<div class="detail-row notes"><div class="k">${escapeHtml(c.label)}</div><div class="v">${escapeHtml(String(v))}</div></div>`
      : `<div class="detail-row"><div class="k">${escapeHtml(c.label)}</div><div class="v">${detailValue(c, v)}</div></div>`;
  };

  let raw = "";
  for (const c of cols) {
    if (c.key === titleCol.key || c.key === "platform") continue;
    const v = row[c.key];
    if (v === undefined || v === null || v === "") continue;
    if (MINE.includes(c.key)) continue;        // the history section tells these properly
    raw += cell(c, v);
  }
  // The personal "history" (purchase price, dates) stays public; the NAS section leaks
  // file paths/sizes, so it's admin-only (the read is empty for anon anyway).
  // A combined card gets no platform detail host: the achievement grid /
  // screenshots / store review are one COPY's story (the lead's, at that), and
  // they live on the per-platform copy drawers instead.
  const groupedRow = !!(row._members && row._members.length > 1);
  if (!row._collection) html += mineSectionHtml(row)
    // The platform detail (achievement grid, personal screenshots, my Steam
    // review) lands async from /api/mine/detail — give it a host to fill.
    + (row._k && !groupedRow ? `<div id="mineExtra" class="mine-extra"></div>` : "")
    // What the backlog is worth here: the challenge buckets beating this would clear.
    // Filled a frame late (fillChallengeDrawer) — computing it runs every challenge
    // over the whole collection, and the drawer opens now.
    + `<div id="chDrawer"></div>`
    + (IS_ADMIN ? nasSectionHtml(row) : "");
  else {                                       // a grouped card's values are aggregates, not yours
    for (const c of cols) {
      const v = row[c.key];
      if (v === undefined || v === null || v === "") continue;
      if (MINE.includes(c.key)) raw = cell(c, v) + raw;
    }
  }
  // Admin escape hatch for a wishlist-only game: map (or fix) its IGDB match by
  // hand. Rendered for every wl-only row — especially the unmatched ones, which
  // have no IGDB section otherwise.
  if (typeof wishlistMapHtml === "function") html += wishlistMapHtml(row);
  html += (typeof editionsHtml === "function" ? editionsHtml(row) : "");
  html += `<div id="relations"></div>`;
  html += collectionSectionHtml(row);
  // Sheet fields collapse behind a "Raw data" disclosure — the enriched view
  // leads. A grouped collection card has no sheet row of its own; its values are
  // aggregates over the members, so don't dress them up as raw data.
  if (IS_ADMIN && raw && !row._collection) html += `<details class="raw-data"><summary>Raw data</summary>${raw}</details>`;
  body.innerHTML = html;
  const back = $("#drawerBack");
  const prev = drawerStack[drawerStack.length - 1];
  const destination = prev ? null : drawerReturn;
  back.hidden = !prev && !destination;
  // The hero has to know, so it can keep its title out from under the button (see .has-back).
  $("#drawer").classList.toggle("has-back", !!prev || !!destination);
  if (prev) {
    const t = drawerTitleOf(prev.row);
    back.textContent = `← ${t.length > 22 ? t.slice(0, 21) + "…" : t}`;
    back.title = `Back to ${t}`;
  } else if (destination) {
    back.textContent = `← ${destination.label}`;
    back.title = `Back to ${destination.label}`;
  }
  wireCollections(body);
  if (typeof wireEditsQuick === "function") wireEditsQuick(body, row);
  if (typeof wireWishlistMap === "function") wireWishlistMap(body, row);
  const artBtn = $("#drawerArt");
  if (artBtn) artBtn.onclick = () => {
    const key = `${row._k}#${String(row.releaseRegion || "").trim()}`;
    // If the shelf is already loaded, we know whether this game has an upload; if not,
    // default to "no" — the Remove button just won't show until the shelf's been opened.
    const g = (typeof SHELF !== "undefined" ? SHELF.games : []).find((x) => x.k === key);
    openCoverEditor({
      key, platform: row.platform, title: row[titleCol.key],
      hasUpload: g ? g.src === "upload" : false,
      caseDefault: g ? g.case : null, existing: g ? g.upload : null,
      onDone: () => { if (typeof SHELF !== "undefined") SHELF.loaded = false; loadUploads(); },
    });
  };
  // A grouped card's members open individually — with a way back to the group.
  body.querySelectorAll("[data-rlc]").forEach((el) => {
    el.onclick = () => {
      // Group rows carry their copies; a plain platform-copy drawer's sibling
      // list lives in DRAWER_EDITIONS (set by editionsHtml during this render).
      const list = row._members || (typeof DRAWER_EDITIONS !== "undefined" && DRAWER_EDITIONS) || [];
      const m = list[+el.dataset.rlc];
      if (m && m !== row) openDrawerFrom(m, "games");
    };
  });
  $("#overlay").hidden = false;
  // Reset scroll AFTER the overlay is shown. Set while it's still display:none it never
  // takes — and the browser then restores the PREVIOUS game's scroll when it appears,
  // which is why one game's scroll position leaked into the next.
  $("#drawer").scrollTop = 0;
  drawerRow = row;
  if (typeof setDocTitle === "function") setDocTitle();   // "<game> · Gamedex" in the address bar
  // Put the open game in the URL so it's shareable and part of browser history: a fresh open
  // pushes a new entry (Back closes it); navigating within the drawer (a related game, a
  // collection member) replaces in place, so the whole drawer stays one history entry. Skipped
  // when the open was itself DRIVEN BY the URL (popstate / deep link) — the URL is already right.
  if (!restoringDrawer && row._k && typeof syncURL === "function") syncURL(!keepStack);
  syncScrollLock();                       // the page behind the drawer must not scroll
  if (ENRICH_ENABLED && row._k && !row._wlOnly) loadDetail(row._k, $("#igdbDetail"), 0, row);
  else if (wlDetail) loadDetail(row._k, $("#igdbDetail"), 0, row, row._igdbId);
  if (row._k && !groupedRow && typeof loadMineDetail === "function") loadMineDetail(row._k, $("#mineExtra"));
  // Two frames out, as Home's challenge spotlight does it: one to paint the drawer we
  // just wrote, one to run the expensive part. fillChallengeDrawer re-checks drawerRow,
  // so a fast click-through leaves the previous game's answer unwritten.
  if (typeof fillChallengeDrawer === "function") {
    requestAnimationFrame(() => requestAnimationFrame(() => fillChallengeDrawer(row)));
  }
}
