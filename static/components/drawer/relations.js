"use strict";

// UI components for relations.js. Feature state and orchestration remain in that module.

// A related game, annotated with whether it's in your collection.
function relCardHtml(entry) {
  const mine = rowsByIgdbId().get(entry.id) || [];
  const row = mine.find((r) => relRowState(r) === "done")
    || mine.find((r) => relRowState(r) === "owned") || mine[0];
  const state = relRowState(row);
  const sheet = row && completedRowSet().has(row) ? "completed" : "games";
  const cover = entry.cover ? IMG(entry.cover, "cover_small") : (row ? coverSrc(ENRICH[row._k], "cover_small") : "");
  const badge = { done: "✓ Beaten", owned: "● Owned", listed: "In your list", none: "Not in your collection" }[state];
  const art = cover
    ? `<img loading="lazy" src="${escapeHtml(cover)}" alt="">`
    : `<span class="rl-ph">${icon("i-library", 18)}</span>`;
  return `<button class="rl-card rl-${state}"${row ? ` data-rlk="${escapeHtml(String(row._k))}" data-rls="${sheet}"` : ""}
      title="${escapeHtml(entry.name)}">
    ${art}
    <span class="rl-txt">
      <b>${escapeHtml(entry.name)}</b>
      <span class="rl-badge rl-b-${state}">${badge}</span>
    </span>
  </button>`;
}

function relationsHtml(detail) {
  const rel = detail && detail.relations;
  if (!rel) return "";

  const sections = [];
  for (const [key, label, single, progress] of REL_SECTIONS) {
    const v = rel[key];
    const list = single ? (v ? [v] : []) : (v || []);
    if (!list.length) continue;
    let head = `${escapeHtml(label)}<span class="muted">${single ? "" : ` ${list.length}`}</span>`;
    if (progress && list.length) {
      const p = relProgress(list);
      const pct = Math.round((p.done / p.total) * 100);
      head += `<span class="rl-prog"><span class="rl-prog-bar"><span style="width:${pct}%"></span></span>`
        + `<span class="rl-prog-txt">${p.done} of ${p.total} beaten${p.owned ? ` · ${p.owned} more owned` : ""}</span></span>`;
    }
    sections.push(`<div class="rl-sect">
      <h4>${head}</h4>
      <div class="rl-row">${list.map(relCardHtml).join("")}</div>
    </div>`);
  }
  if (!sections.length) return "";

  const kind = rel.gameTypeLabel && rel.gameTypeLabel !== "Main game"
    ? `<span class="rl-kind">${escapeHtml(rel.gameTypeLabel)}${rel.versionTitle ? ` · ${escapeHtml(rel.versionTitle)}` : ""}</span>` : "";
  return `<div class="rl">
    <div class="rl-head"><h3>${icon("i-layers", 16)} Related games</h3>${kind}</div>
    ${sections.join("")}
  </div>`;
}

function editionsHtml(row) {
  let ms = row._members;
  if ((!ms || ms.length < 2) && row._k && !row._collection && !row._wlOnly
      && (typeof drawerSheet === "undefined" || drawerSheet === "games")) {
    const sibs = gamesByGid().get(cachedGameId(row)) || [];
    if (sibs.length >= 2 && sibs.includes(row)) ms = sibs;
  }
  DRAWER_EDITIONS = ms || null;
  if (!ms || ms.length < 2) return "";
  return `<div class="rl">
    <div class="rl-head"><h3>${icon("i-combine", 16)} Your copies <span class="muted">${ms.length}</span></h3></div>
    <div class="rl-copies">${ms.map((m, i) => {
      const e = ENRICH[m._k] || {};
      const kind = e.rel && e.rel.type && e.rel.type !== "Main game" ? e.rel.type : "";
      const bits = [m.platform, m.releaseRegion, m.releaseYear].filter(Boolean)
        .map((x) => escapeHtml(String(x))).join(" · ");
      const cur = m === row;
      const mark = cur ? `<span class="rl-b-cur">Viewing</span>`
        : m.completed ? `<span class="rl-b-done">✓ Beaten</span>`
        : m.owned ? `<span class="rl-b-owned">● Owned</span>` : "";
      const mine = typeof minePillsHtml === "function" ? minePillsHtml(m._k) : "";
      return `<button class="rl-copy${cur ? " cur" : ""}" data-rlc="${i}">
        <span class="rl-copy-t">${bits}${kind ? ` <span class="rl-tag">${escapeHtml(kind)}</span>` : ""}</span>${mark}${
        mine ? `<span class="rl-copy-mine mine-pills">${mine}</span>` : ""}</button>`;
    }).join("")}</div>
  </div>`;
}
