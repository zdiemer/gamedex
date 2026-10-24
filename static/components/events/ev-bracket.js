"use strict";

// UI components for ev-bracket.js. Feature state and orchestration remain in that module.

/* ---- the page ------------------------------------------------------------- */
function brSideHtml(key, seed, opts) {
  const row = key ? evRow(key) : null;
  if (!row) return `<div class="ev-side pending"><span class="ev-seed">—</span><span class="ev-side-t">Waiting on the round before</span></div>`;
  const won = opts.winner === key;
  const lost = opts.winner && opts.winner !== key;
  return `<div class="ev-side${won ? " won" : ""}${lost ? " lost" : ""}">
    <span class="ev-seed">${seed != null ? seed + 1 : ""}</span>
    <button class="ev-side-t" data-evopen="${escapeHtml(key)}">${escapeHtml(String(row.title))}
      <span class="m">${escapeHtml(String(row.platform || ""))}${row.metacriticRating != null
        ? " · " + Math.round(+row.metacriticRating * 100) : ""}</span></button>
    ${opts.votable ? `<button class="btn sm" data-brmatch="${opts.id}" data-brkey="${escapeHtml(key)}">Pick</button>` : ""}
  </div>`;
}

function brMatchHtml(round, i, pair) {
  const st = brYearState();
  const id = `r${round + 1}m${i + 1}`;
  const winner = st.votes[id] || null;
  const n = (() => {           // the match's number in the running order, 1..15
    let base = 0;
    for (let r = 0; r < round; r++) base += 8 >> r;
    return base + i + 1;
  })();
  const open = n <= brOpen();
  const ready = pair[0] && pair[1];
  const votable = open && ready && !winner;
  const seedOf = (k) => round === 0 ? st.seeds.indexOf(k) : null;
  return `<div class="ev-match${votable ? " live" : ""}${winner ? " done" : ""}${open ? "" : " shut"}">
    <span class="ev-match-n">${n}${votable ? "<em>vote</em>" : ""}</span>
    ${brSideHtml(pair[0], seedOf(pair[0]), { winner, votable, id })}
    <span class="ev-vs">vs</span>
    ${brSideHtml(pair[1], seedOf(pair[1]), { winner, votable, id })}
    ${open ? "" : `<span class="ev-match-lock">opens on day ${n}</span>`}
  </div>`;
}

function brRender(host) {
  const ev = EV.byId.bracket;
  const st = brYearState();
  const champ = brChampion();
  const cands = brCandidates().length;
  const acts = brSeeded()
    ? `<button class="btn ghost" id="brReseed">${icon("i-refresh", 15)} Re-seed the bracket</button>`
    : `<button class="btn" id="brSeed">${icon("i-trophy", 15)} Seed the bracket</button>`;

  const rounds = brSeeded() ? brTree() : [];
  host.innerHTML = evHeroHtml(ev, {
    acts,
    note: brSeeded() ? "" : `${cands.toLocaleString()} games are marked Will Play or Must Play. The top 16 by rating get in.`,
  }) + `<div class="ev-wrap">
    ${champ ? `<section class="ev-champ">
      <span class="h-eyebrow">The champion</span>
      ${evTileHtml(champ, { cls: "big" })}
      <p class="ev-p">That is April's job now.</p>
    </section>` : ""}
    ${brSeeded() ? `<div class="ev-bracket">
      ${rounds.map((matches, r) => `<div class="ev-round">
        <h3>${BR_ROUNDS[r]}</h3>
        ${matches.map((pair, i) => brMatchHtml(r, i, pair)).join("")}
      </div>`).join("")}
    </div>` : `<p class="ev-none">Nothing is seeded yet. Seeding draws the top 16 of the ${cands.toLocaleString()} games you marked Will Play or Must Play.</p>`}
  </div>`;

  // The match id and the game key travel in separate attributes: a match key is
  // "title|platform|year", so one packed string split on a pipe loses most of the game.
  host.querySelectorAll("[data-brmatch]").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const key = el.dataset.brkey;
      const m = el.dataset.brmatch.match(/^r(\d+)m(\d+)$/);
      if (!m) return;
      if (brCast(+m[1], +m[2], key)) {
        const row = evRow(key);
        showToast(`${row ? String(row.title) : "Picked"} goes through`);
      }
      brRender(host); evWireTiles(host);
    };
  });
  const seed = document.getElementById("brSeed") || document.getElementById("brReseed");
  if (seed) seed.onclick = () => {
    if (brSeeded() && !confirm("Re-seed? Every vote so far is thrown away.")) return;
    const n = brSeed();
    showToast(n ? `${n} seeds drawn` : "Nothing is marked Will Play or Must Play yet");
    brRender(host); evWireTiles(host);
  };
  if (typeof maybeEnrich === "function") maybeEnrich(st.seeds.map(evRow).filter(Boolean));
}
