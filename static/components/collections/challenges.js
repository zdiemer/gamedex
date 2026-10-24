"use strict";

// UI components for challenges.js. Feature state and orchestration remain in that module.

// ---- rendering -----------------------------------------------------------
function chRing(pct, size = 54) {
  const r = size / 2 - 4, circ = 2 * Math.PI * r;
  return `<svg class="ch-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ch-ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ch-ring-fg"
      stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - pct)).toFixed(1)}"/>
    <text x="50%" y="50%" class="ch-ring-txt">${Math.round(pct * 100)}%</text></svg>`;
}

function chCardHtml(res) {
  const { c, cleared, remaining, total } = res;
  const done = total > 0 && remaining.size === 0;
  const times = res.paths.length
    ? `<span class="ch-badge">✓ cleared ${res.paths.length}×</span>` : "";
  return `<button class="ch-card${done ? " ch-done" : ""}" data-ch="${c.id}">
    <div class="ch-card-top">
      <span class="ch-icon">${glyph(c.icon, 20)}</span>
      ${chRing(res.pct)}
    </div>
    <h3>${escapeHtml(c.name)}</h3>
    <div class="ch-count"><b>${cleared.size}</b> of ${total} cleared</div>
    <div class="ch-bar"><span style="width:${(res.pct * 100).toFixed(1)}%"></span></div>
    <div class="ch-foot">
      <span>${remaining.size ? `${remaining.size} to go` : "Complete!"}</span>
      <span class="muted">${escapeHtml(chPathLabel(res))}</span>
    </div>
    ${times}</button>`;
}

// A candidate/clearing game as a compact chip.
function chGameChip(row, note) {
  const cs = coverSrc(ENRICH[row._k], "cover_small");
  const art = cs ? `<img src="${cs}" alt="" loading="lazy">` : `<span class="ch-chip-ph">${icon("i-library", 16)}</span>`;
  const cr = combinedRating(row);
  const sub = [row.platform, row.releaseYear].filter(Boolean).map(String).map(escapeHtml).join(" · ");
  const meta = note
    ? `<span class="ch-chip-note">${escapeHtml(note)}</span>`
    : (cr != null ? `<span class="ch-chip-score ${ratingClass(cr)}">${Math.round(cr * 100)}%</span>` : "");
  return `<button class="ch-chip" data-gk="${escapeHtml(String(row._k || ""))}" data-gt="${escapeHtml(String(row.title))}" data-gp="${escapeHtml(String(row.platform || ""))}">
    ${art}<span class="ch-chip-txt"><b>${escapeHtml(String(row.title))}</b><span class="muted">${sub}</span></span>${meta}</button>`;
}

// The cleared map is built by the replay in the order the buckets actually fell, so its
// own insertion order IS the timeline — there's nothing to sort.
function chTimelineHtml(cleared) {
  const nodes = [...cleared.entries()]
    // the clearing list is in path order, so [0] is the game that actually cleared it
    .map(([key, rows]) => ({ key, row: rows[0], also: rows.length - 1 }))
    .filter((n) => n.row);
  if (!nodes.length) return "";

  return `<div class="chtl">` + nodes.map(({ key, row, also }) => {
    // The SAME listing card as the grid and Home — a game is a game wherever you meet it.
    // The bucket it cleared and the date it fell are the note, because that is the one thing
    // that's true here and nowhere else. The rail, the dot and nothing else are ours.
    // The note is the bucket and the day it fell — nothing else. "+31 more" (the other games
    // beaten in that bucket since) ran the note to three lines and swallowed the cover it was
    // sitting on, for a number nobody came here to read. It lives in the tooltip.
    const tip = `${row.title} · cleared ${key} on ${chWhenLong(row)}`
      + (also ? ` (${also} more completed in this bucket since)` : "");
    const card = posterCardHtml(row, {
      cls: "chtl-card",
      note: `<b>${escapeHtml(String(key))}</b> · ${escapeHtml(chWhen(row))}`,
      attrs: `title="${escapeHtml(tip)}"
              data-gk="${escapeHtml(String(row._k || ""))}"
              data-gt="${escapeHtml(String(row.title))}"
              data-gp="${escapeHtml(String(row.platform || ""))}"`,
    });
    return `<div class="chtl-node"><span class="chtl-dot"></span>${card}</div>`;
  }).join("") + `</div>`;
}

function chClearedTimeline(res) {
  const rail = chTimelineHtml(res.cleared);
  if (!rail) return `<div class="ch-empty">Nothing cleared yet.</div>`;
  const firsts = [...res.cleared.values()].map((rows) => rows[0]);
  return `<p class="ch-hint">Oldest first · ${escapeHtml(chSpanText(firsts))}.
    Tap a cover for the game that cleared it.</p>${rail}`;
}

/* The paths already walked.

   `timesCompleted` used to be a number typed into the challenge and shown as a badge, and
   a badge is where it ended: you cleared this thing three times and all you got was a 3.
   The replay knows every game that cleared every bucket on every lap, so the count opens
   up into the routes themselves — collapsed by default, because the live path is what you
   came for and the history is what you go looking for. */
function chPathsHtml(res) {
  if (!res.paths.length) return "";
  const html = res.paths.map((p, i) => {
    const firsts = [...p.cleared.values()].map((rows) => rows[0]);
    // No closing date here: a path ends the moment its last bucket falls, so the date
    // would be the one chSpanText already printed on the end of the span.
    return `<details class="ch-path">
      <summary>
        <span class="ch-path-n">Path ${i + 1}</span>
        <span class="ch-path-span">${escapeHtml(chSpanText(firsts))}</span>
        <span class="muted">${p.cleared.size} bucket${p.cleared.size !== 1 ? "s" : ""} ·
          ${p.games.toLocaleString()} game${p.games !== 1 ? "s" : ""} completed</span>
        <span class="ch-path-done">✓ cleared</span>
      </summary>
      ${chTimelineHtml(p.cleared)}
    </details>`;
  }).reverse().join("");   // most recent first — Path 1 is the deepest history
  return `<h2 class="ch-sec">Paths already walked <span class="muted">${res.paths.length}</span></h2>
    <p class="ch-hint">Every time the last bucket fell the slate wiped and a new path opened.
      These are the routes you took — open one for the games that cleared it.</p>
    <div class="ch-paths">${html}</div>`;
}

function chBucketList(res, map) {
  const entries = chSortBuckets(res, map);
  if (!entries.length) {
    return `<div class="ch-empty">Nothing left. Challenge complete.</div>`;
  }
  /* Nothing to nominate for any of them: the bucket keys are all there is to show, and
     366 full-width cards each announcing "0 candidates" is a great deal of furniture built
     around an absence. They become chips instead, and the cap comes off with them — a chip
     costs a slot in a wrapping row, which is what made the cap worth having. */
  if (entries.every(([, rows]) => !rows.length)) {
    return `<div class="ch-keys">` + entries
      .map(([key]) => `<span class="ch-key">${escapeHtml(String(key))}</span>`).join("") + `</div>`;
  }

  const show = chState.showAll === "todo" ? entries : entries.slice(0, CH_BUCKETS_SHOWN);
  const html = show.map(([key, rows]) => {
    const games = rows.slice(0, CH_CANDIDATES_SHOWN).map((r) => chGameChip(r)).join("");
    const extra = rows.length > CH_CANDIDATES_SHOWN
      ? `<span class="ch-more">+${rows.length - CH_CANDIDATES_SHOWN} more</span>` : "";
    // A grouping key still resolves as a Pick criterion when the bucket is empty, but
    // rolling it can only ever come back with nothing.
    const canPick = !!rows.length && !!chPickCriteria(res.c, key);
    return `<div class="ch-bucket">
      <div class="ch-bucket-head"><h4>${escapeHtml(String(key))}</h4>
        <span class="muted">${rows.length} candidate${rows.length !== 1 ? "s" : ""}</span>
        ${canPick ? `<button class="ch-pickone" data-pickbk="${escapeHtml(String(key))}"
          title="Roll one of these in the Pick tab">${icon("i-dice", 13)} Pick me one</button>` : ""}</div>
      <div class="ch-chips">${games}${extra}</div></div>`;
  }).join("");
  const rest = entries.length - show.length;
  const more = rest > 0
    ? `<button class="ch-showall" data-showall="todo">Show all ${entries.length}</button>` : "";
  return html + more;
}

function chLedgerHtml(results) {
  const items = chLedger(results);
  if (!items.length) return "";
  const rows = items.map(({ row, tags }) => {
    const cs = coverSrc(ENRICH[row._k], "cover_small");
    const art = cs ? `<img src="${cs}" alt="" loading="lazy">`
      : `<span class="chled-ph">${icon("i-library", 13)}</span>`;
    const shown = tags.slice(0, CH_LEDGER_TAGS).map(({ c, key }) =>
      `<button class="chled-tag" data-chgo="${escapeHtml(c.id)}"
        title="${escapeHtml(`${row.title} cleared ${key} in ${c.name}, ${chWhenLong(row)}`)}">
        ${glyph(c.icon, 11)}<b>${escapeHtml(String(key))}</b>
        <span class="muted">${escapeHtml(chTagName(c.name))}</span></button>`).join("");
    const rest = tags.length - CH_LEDGER_TAGS;
    return `<li class="chled-row">
      <button class="chled-game" data-gk="${escapeHtml(String(row._k || ""))}"
        data-gt="${escapeHtml(String(row.title))}" data-gp="${escapeHtml(String(row.platform || ""))}">
        ${art}<span class="chled-title">${escapeHtml(String(row.title))}</span>
      </button>
      <span class="chled-tags">${shown}${rest > 0 ? `<span class="ch-more">+${rest} more</span>` : ""}</span>
      <span class="chled-when">${escapeHtml(chWhen(row))}</span>
    </li>`;
  }).join("");
  return `<div class="chled-wrap">
    <h2 class="ch-sec">Recently cleared <span class="muted">last ${items.length}</span></h2>
    <p class="ch-hint">The last games to knock a group out, newest first — one game often
      clears several at once. Tap a game for its details, or a group for its challenge.</p>
    <ol class="chled">${rows}</ol>
  </div>`;
}

function chDrawerHtml(row) {
  if (typeof DATA === "undefined" || !DATA || !DATA.sheets) return "";
  // historyOf joins both sheets: a game marked Completed nowhere but present on the
  // Finished Games sheet is still beaten, and still has nothing to clear.
  if (typeof historyOf === "function" && historyOf(row).beaten) return "";
  const hits = chWouldClear(row);
  if (!hits.length) return "";
  const chals = new Set(hits.map((h) => h.c.id)).size;

  const items = hits.map(({ c, res, key, rivals }) => {
    const est = CH_ESTIMATED_FIELDS.has(chGroupField(c));
    const sub = [chTagName(c.name), `${res.remaining.size} to go`, est ? "on its estimate" : ""]
      .filter(Boolean).join(" · ");
    const left = rivals
      ? `${rivals} other candidate${rivals !== 1 ? "s" : ""}`
      : "nothing else left";
    const tip = `${c.name}: "${key}" is still to clear`
      + (rivals ? ` — ${rivals} other unplayed game${rivals !== 1 ? "s" : ""} could clear it too`
                : " — no other unplayed game in the collection can clear it")
      + (est ? ". Bucketed on the estimated playtime; the real completion time decides it." : "");
    return `<li><button class="chd-row${rivals ? "" : " chd-only"}" data-chgo="${escapeHtml(String(c.id))}"
      title="${escapeHtml(tip)}">
      <span class="ch-icon">${glyph(c.icon, 18)}</span>
      <span class="chd-txt"><b>${escapeHtml(String(key))}</b>
        <span class="muted">${escapeHtml(sub)}</span></span>
      <span class="chd-left">${escapeHtml(left)}</span></button></li>`;
  }).join("");

  return `<div class="mine-sect chd-sect">
    <h3>${icon("i-target", 15)} Beating this would clear
      <span class="muted">${hits.length} bucket${hits.length !== 1 ? "s" : ""} across ${chals} challenge${chals !== 1 ? "s" : ""}</span></h3>
    <ol class="chd-list">${items}</ol>
  </div>`;
}

/* Filled a frame late, for the reason home.js's spotlight is (see CHAL_SLOT): the first
   call runs every challenge over the whole collection, and a drawer must open now. Once
   the results are cached the refill is free, so it isn't worth a second code path. */
function fillChallengeDrawer(row) {
  const slot = document.getElementById("chDrawer");
  // Slow first computation, and the drawer may have moved on (or closed) meanwhile.
  if (!slot || drawerRow !== row) return;
  slot.innerHTML = chDrawerHtml(row);
  for (const el of slot.querySelectorAll(".chd-row[data-chgo]")) {
    const id = el.dataset.chgo;
    el.onclick = () => {
      closeDrawer(true);        // silent — goTab's nav() writes the drawer-free URL for this jump
      goTab("challenges", () => { chState.open = id; chState.showAll = null; });
    };
  }
}

function renderChallenges() {
  const host = $("#challenges");
  if (!DATA) return;

  if (chEditor.open) {
    host.innerHTML = chEditorHtml();
    wireEditor(host);
    host.scrollTop = 0;
    return;
  }

  const all = chAll();
  if (!chState.open) {
    const results = all.map(computeChallenge);
    const totalCleared = results.reduce((a, r) => a + r.cleared.size, 0);
    const totalBuckets = results.reduce((a, r) => a + r.total, 0);
    const finished = results.filter((r) => r.total && !r.remaining.size).length;
    const walked = results.reduce((a, r) => a + r.paths.length, 0);
    host.innerHTML =
      `<div class="ch-hero">
         <h1>Challenges</h1>
         <p>One game per platform, per genre, per year, per letter… Progress is read straight from the sheet, over everything you've ever completed: a bucket clears the day you beat something in it, and clearing the last one you can reach starts the whole challenge over.</p>
         <div class="ch-hero-stats">
           <span><b>${all.length}</b> challenges</span>
           <span><b>${totalCleared.toLocaleString()}</b> buckets cleared</span>
           <span><b>${(totalBuckets - totalCleared).toLocaleString()}</b> to go</span>
           ${finished ? `<span><b>${finished}</b> completed</span>` : ""}
           ${walked ? `<span><b>${walked.toLocaleString()}</b> paths walked</span>` : ""}
         </div>
       </div>
       <div class="ch-grid">${results.map(chCardHtml).join("")}
         <button class="ch-card ch-new" id="chNew">
           <span class="ch-new-plus">＋</span>
           <b>New challenge</b>
           <span class="muted">One per anything you can filter by (themes, storefronts, developers, Steam Deck rating).</span>
         </button>
       </div>
       ${chLedgerHtml(results)}`;
    const openCh = (id) => { chState.open = id; chState.showAll = null; renderChallenges(); nav(); };
    for (const el of host.querySelectorAll(".ch-card[data-ch]")) {
      el.onclick = () => openCh(el.dataset.ch);
    }
    for (const el of host.querySelectorAll(".chled-tag")) {
      el.onclick = () => openCh(el.dataset.chgo);
    }
    const byCard = chCardIndex();
    for (const el of host.querySelectorAll(".chled-game")) {
      const row = byCard.get(chElKey(el));
      if (row) el.onclick = () => openDrawer(row, "games");
    }
    $("#chNew").onclick = () => chOpenEditor(null);
    return;
  }

  const c = all.find((x) => x.id === chState.open) || all[0];
  const res = computeChallenge(c);
  const times = res.paths.length
    ? `<span class="ch-badge">✓ cleared ${res.paths.length}× already</span>` : "";
  // When this path opened. One running from the undated prehistory hasn't got a date to
  // show: on a challenge nobody has finished, that's every game you've ever beaten
  // ("all time"); on a later path it means the batch it opened in.
  const from = res.pathFrom ? fmtDate(res.pathFrom)
    : (res.paths.length ? "Prehistory" : "All time");
  // A fixed vocabulary means the bucket depends on the completion rather than the game, so
  // there is no shortlist to rank and promising one would be a lie.
  const todoHint = res.fixed
    ? "The buckets nothing has landed in yet. Any game clears any of them, so there's nothing to shortlist: it's the day you finish on that counts."
    : "Top-rated candidates for each, five shown. Tap any game for details.";
  host.innerHTML =
    `<div class="ch-detail">
       <button class="ch-back" id="chBack">← All challenges</button>
       ${c.custom ? `<button class="btn ghost ch-edit" id="chEdit">✎ Edit challenge</button>` : ""}
       <div class="ch-detail-head">
         <span class="ch-icon big">${glyph(c.icon, 30)}</span>
         <div>
           <h1>${escapeHtml(c.name)}</h1>
           <p>${escapeHtml(c.blurb)}</p>
           ${times}
         </div>
         ${chRing(res.pct, 92)}
       </div>
       <div class="ch-bar big"><span style="width:${(res.pct * 100).toFixed(1)}%"></span></div>
       <div class="ch-stats">
         <div><b>${res.cleared.size}</b><span>cleared</span></div>
         <div><b>${res.remaining.size}</b><span>remaining</span></div>
         <div><b>${res.total}</b><span>total</span></div>
         <div><b>${escapeHtml(from)}</b><span>${res.paths.length ? "path opened" : "counting from"}</span></div>
         <div><b>${res.completedThisPath.toLocaleString()}</b><span>games completed ${res.paths.length ? "this path" : "overall"}</span></div>
       </div>
       <h2 class="ch-sec">Still to do <span class="muted">${res.remaining.size}</span></h2>
       <p class="ch-hint">${todoHint}</p>
       <div class="ch-buckets">${chBucketList(res, res.remaining)}</div>
       <h2 class="ch-sec">Cleared <span class="muted">${res.cleared.size}</span></h2>
       ${chClearedTimeline(res)}
       ${chPathsHtml(res)}
     </div>`;

  $("#chBack").onclick = () => { chState.open = null; chState.showAll = null; renderChallenges(); nav(); };
  const edit = $("#chEdit");
  if (edit) edit.onclick = () => chOpenEditor(c.custom);
  for (const el of host.querySelectorAll(".ch-pickone")) {
    el.onclick = (e) => { e.stopPropagation(); chPickFromBucket(res.c, el.dataset.pickbk); };
  }
  for (const el of host.querySelectorAll(".ch-showall")) {
    el.onclick = () => { chState.showAll = el.dataset.showall; renderChallenges(); };
  }
  const byCard = chCardIndex();
  for (const el of host.querySelectorAll(".ch-chip, .chtl-card")) {
    const row = byCard.get(chElKey(el));
    if (!row) continue;
    el.onclick = () => openDrawer(row, "games");
    // It's the grid's card, so it gets the grid's hover-to-play trailer too. Anything less
    // and it would only LOOK like the same card.
    if (el.classList.contains("chtl-card")) wirePreviewFor(el, row);
  }
  host.scrollIntoView({ block: "start" });
}

function chEditorHtml() {
  const d = chEditor.def;
  const [gfk, gtid] = String(d.groupBy || "").split("|");
  const fields = chGroupFields();
  const base = chGroupFieldByKey(gfk) || fields[0];
  const transforms = chTransformsFor(base);
  const opt = (v, label, sel) => `<option value="${escapeHtml(v)}"${v === sel ? " selected" : ""}>${escapeHtml(label)}</option>`;

  pkbUse(CH_BUILDER);
  return `<div class="chb">
    <div class="chb-head">
      <h2>${d._editing ? "Edit" : "New"} challenge</h2>
      <button class="chb-close" id="chbClose">✕</button>
    </div>
    <label class="chb-row"><span>Name</span>
      <input id="chbName" type="text" value="${escapeHtml(d.name)}" placeholder="One per Steam Deck rating…" maxlength="60">
    </label>
    <label class="chb-row"><span>Icon</span>
      <input id="chbIcon" type="text" value="${escapeHtml(d.icon)}" maxlength="4" style="width:64px">
    </label>
    <div class="chb-row"><span>One per…</span>
      <div class="chb-group">
        <select id="chbGroup">${fields.map((c) => opt(c.key, c.label, base.key)).join("")}</select>
        ${transforms.length > 1
          ? `<select id="chbGroupT">${transforms.map((t) => opt(t.id, t.label, gtid || "")).join("")}</select>`
          : ""}
        <em>Every game you've ever completed counts, the same rule the built-ins use.
          Clear the last bucket you can reach and the challenge starts over.</em>
      </div>
    </div>
    <div class="chb-row chb-filters">
      <span>Only these games</span>
      <div>
        <div class="pick-builder" id="chbBuilder">${pickGroupHtml(CH_BUILDER.root(), [])}</div>
        <em class="muted">Leave it empty and every game is in play. Same criteria builder as
          the Pick tab — so it nests, and any criterion can be negated.</em>
      </div>
    </div>
    <div class="chb-preview" id="chbPreview"></div>
    <div class="chb-actions">
      ${d._editing ? `<button class="btn danger" id="chbDelete">Delete</button>` : ""}
      <span class="spacer"></span>
      <button class="btn ghost" id="chbCancel">Cancel</button>
      <button class="btn launch" id="chbSave">Save challenge</button>
    </div>
  </div>`;
}

// Live preview: how many buckets would this challenge actually have?
function chPreview() {
  const host = $("#chbPreview");
  if (!host) return;
  try {
    const draft = { ...chEditor.def, fb: pickEncode(pickPruned(chEditTree || pickGroup())) };
    const res = computeChallenge(chFromCustom(draft));
    const walked = res.paths.length
      ? ` · <b>${res.paths.length}</b> path${res.paths.length !== 1 ? "s" : ""} you've already walked`
      : "";
    host.innerHTML = res.total
      ? `<b>${res.total}</b> buckets · <b>${res.cleared.size}</b> already cleared by past completions · <b>${res.remaining.size}</b> to go${walked}`
      : `<span class="muted">No buckets. That combination of facet and filters matches nothing.</span>`;
  } catch (e) {
    host.innerHTML = `<span class="muted">Can't evaluate that yet.</span>`;
  }
}
