"use strict";

// UI components for ev-classof.js. Feature state and orchestration remain in that module.

function classofRender(host) {
  const ev = EV.byId.classof;
  const st = classofState();
  const year = st.dial;
  const now = evNow().getFullYear();
  const { rows, owned, done } = classofStats(year);
  const rate = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : (r.metacriticRating || 0));
  const sorted = rows.slice().sort((a, b) => rate(b) - rate(a));
  const shown = sorted.slice(0, 60);

  const rungs = CLASSOF_RUNGS.map((n) => {
    const y = now - n;
    const c = classofRows(y).length;
    return `<button class="ev-rung${y === year ? " on" : ""}" data-classof="${y}">
      <b>${y}</b><span>${n} years</span><i>${c ? c.toLocaleString() + " games" : "nothing yet"}</i>
    </button>`;
  }).join("");

  host.innerHTML = evHeroHtml(ev, {
    acts: `<button class="btn ghost" data-classof="${year - 1}">← ${year - 1}</button>
           <span class="ev-dial-y">${year}</span>
           <button class="btn ghost" data-classof="${year + 1}"${year >= now ? " disabled" : ""}>${year + 1} →</button>`,
    note: `${rows.length.toLocaleString()} on the sheet · ${owned.toLocaleString()} owned · ${done.toLocaleString()} finished`,
  }) + `<div class="ev-wrap">
    <div class="ev-rungs">${rungs}</div>
    ${rows.length ? `<div class="ev-yearbook">${shown.map((r) => {
      const badge = r.completed ? `<span class="ev-badge done">finished</span>`
        : r.owned ? `<span class="ev-badge own">owned</span>`
        : r.wishlisted ? `<span class="ev-badge wish">wishlisted</span>` : "";
      const mc = r.metacriticRating != null ? Math.round(+r.metacriticRating * 100) : null;
      return `<div class="ev-yb">${evTileHtml(r, { sub: `${r.platform || ""}${mc != null ? " · " + mc : ""}` })}${badge}</div>`;
    }).join("")}</div>
    ${sorted.length > shown.length ? `<p class="ev-more">${(sorted.length - shown.length).toLocaleString()} more from ${year}.</p>` : ""}`
    : `<p class="ev-none">Nothing on the sheet was released in ${year}. The dial runs out somewhere around 1981.</p>`}
  </div>`;

  host.querySelectorAll("[data-classof]").forEach((el) => {
    el.onclick = () => { classofSet(el.dataset.classof); classofRender(host); evWireTiles(host); };
  });
  if (typeof maybeEnrich === "function") maybeEnrich(shown);
}
