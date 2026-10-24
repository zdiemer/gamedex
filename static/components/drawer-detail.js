"use strict";

// The carousel's contents: trailers first (they autoplay, muted, when their
// slide is showing), then screenshots, then key art.
function mediaOf(d) {
  return [
    ...(d.videos || []).slice(0, 6).map((v) => ({ kind: "video", id: v.id, name: v.name || "Trailer" })),
    ...(d.screenshots || []).map((id) => ({ kind: "image", id })),
    ...(d.artworks || []).map((id) => ({ kind: "image", id, art: true })),
  ];
}

// The drawer's Tags row: one combined list of chips (genres, themes, perspectives, modes,
// then IGDB's long keyword tail). Past TAG_CAP the overflow collapses behind a "+N more"
// chip — a game with fifty keywords otherwise pushes the whole drawer down. The reveal is
// wired by delegation in chrome.js; each chip is still its own facet-link.
const TAG_CAP = 12;
function tagChipsHtml(items) {
  if (!items.length) return "";
  const chip = (it) => chipHtml(it.x, { facet: it.fk });
  if (items.length <= TAG_CAP) return `<div class="chips tag-chips">${items.map(chip).join("")}</div>`;
  const shown = items.slice(0, TAG_CAP).map(chip).join("");
  const rest = items.slice(TAG_CAP).map(chip).join("");
  return `<div class="chips tag-chips collapsed">${shown}` +
    `<span class="tag-rest">${rest}</span>` +
    `<button class="chip tag-more" type="button">+${items.length - TAG_CAP} more</button></div>`;
}

function detailHtml(d) {
  if (!d) return "";
  const cs = coverSrc(d, "cover_big");
  const cover = cs ? `<img class="cover-big" src="${cs}" alt="">` : "";
  const badge = d.manual ? `<span class="chip manual">★ Manually mapped</span>` : "";
  const rating = d.rating != null
    ? `<div class="igdb-rating ${ratingClass(d.rating)}">${Math.round(d.rating * 100)}<small>/100 IGDB</small>${d.ratingCount ? ` · ${d.ratingCount} ratings` : ""}</div>` : "";
  const linkList = (arr, fk) => arr.map((x) =>
    `<a class="facet-link" data-fk="${fk}" data-fv="${escapeHtml(String(x))}">${escapeHtml(String(x))}</a>`).join(", ");
  const meta = [];
  const uniq = (a) => [...new Set(a)];
  if (d.developers && d.developers.length) meta.push(`<div class="detail-row"><div class="k">Developer</div><div class="v">${linkList(uniq(d.developers.map(canonDev)), "developer")}</div></div>`);
  if (d.publishers && d.publishers.length) meta.push(`<div class="detail-row"><div class="k">Publisher</div><div class="v">${linkList(uniq(d.publishers.map(canonPub)), "publisher")}</div></div>`);
  if (d.franchises && d.franchises.length) meta.push(`<div class="detail-row"><div class="k">Franchise</div><div class="v">${linkList(uniq(d.franchises.map(canonFran)), "franchise")}</div></div>`);
  if (d.engines && d.engines.length) meta.push(`<div class="detail-row"><div class="k">Engine</div><div class="v">${linkList(uniq(d.engines), "__igdb_engine")}</div></div>`);
  if (d.ageRating) meta.push(`<div class="detail-row"><div class="k">Rated</div><div class="v age-v">${ageBadgeHtml(d.ageRating)}<a class="facet-link" data-fk="__igdb_age" data-fv="${escapeHtml(d.ageRating)}">${escapeHtml(d.ageRating)}</a></div></div>`);
  const nShots = mediaOf(d).length;
  const shots = nShots
    ? `<div class="shots"><div class="shot-view"></div>` +
      (nShots > 1 ? `<button class="shot-nav prev" aria-label="Previous">‹</button><button class="shot-nav next" aria-label="Next">›</button>` : "") +
      `<div class="shot-count"></div><div class="shot-cap"></div></div>` : "";
  // Computed at home, not fetched: feature overlap (franchise, developer,
  // keywords, era…) between this game and every game on the sheet, weighted by
  // how rare each shared feature is in the collection (similar.js). IGDB's own
  // similar_games list orbited the same few ubiquitous titles; this one has to
  // earn each entry — and every entry opens in-app instead of navigating away.
  const similar = typeof similarByFeatures === "function" ? similarByFeatures(d, drawerRow) : [];
  const simHtml = similar.length
    ? `<div class="detail-row notes"><div class="k">Similar games you own <span class="muted">${similar.length}</span></div>
        <div class="similar">${similar.map((s) => {
          const cover = s.cover ? IMG(s.cover, "cover_small") : coverSrc(ENRICH[s.row._k], "cover_small");
          const mark = s.row.completed ? `<i class="sim-done" title="Beaten">✓</i>`
            : s.row.owned ? `<i class="sim-owned" title="Owned">●</i>` : "";
          return `<button class="sim" data-simk="${escapeHtml(String(s.row._k || ""))}" title="${escapeHtml(s.name + (s.why ? " — " + s.why : ""))}">
            ${cover ? `<img loading="lazy" src="${escapeHtml(cover)}" alt="">` : `<span class="sim-ph">${icon("i-library", 18)}</span>`}
            ${mark}
            <span>${escapeHtml(s.name)}</span>
          </button>`;
        }).join("")}</div></div>`
    : "";

  const text = d.summary || d.storyline;
  // Genre / theme / mode, under the summary. They're a way INTO the collection
  // (every chip is a filter), so they belong next to the prose that made you
  // curious, not stacked above the cover.
  // Genre chips filter the UNIFIED genre facet (canonicalised so an IGDB "Platform"
  // chip filters "Platformer"); themes/modes stay IGDB-only facets.
  // Curated genres lead — "Nonogram" is the thing I actually went looking for, and IGDB's
  // own list would only ever say "Puzzle".
  const curated = drawerRow ? curatedGenres(drawerRow) : [];
  const genreChips = [...new Set([...curated, ...(d.genres || []).map((g) => String(canonGenre(g)))])];
  // One combined, capped list: genres/themes/perspectives/modes first, then IGDB's long
  // keyword tail. Everything past TAG_CAP folds behind "+N more" (tagChipsHtml).
  const tagItems = [
    ...genreChips.map((x) => ({ x, fk: "genre" })),
    ...(d.themes || []).map((x) => ({ x, fk: "__igdb_theme" })),
    ...(d.perspectives || []).map((x) => ({ x, fk: "__igdb_persp" })),
    ...(d.gameModes || []).map((x) => ({ x, fk: "__igdb_mode" })),
    ...(d.keywords || []).map((x) => ({ x, fk: "__igdb_kw" })),
  ];
  const tags = tagChipsHtml(tagItems);
  return (badge ? `<div class="badges">${badge}</div>` : "") +
    (text ? `<div class="detail-row notes"><div class="k">Summary (${escapeHtml(d.source || "IGDB")})</div><div class="v">${escapeHtml(text)}</div></div>` : "") +
    (tags ? `<div class="detail-row notes tag-row"><div class="k">Tags</div><div class="v">${tags}</div></div>` : "") +
    meta.join("") + shots + simHtml +
    igdbAttr(d);
}

function igdbAttr(d) {
  const name = d.source || "IGDB";
  const link = d.url ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">View on ${escapeHtml(name)} ↗</a> · ` : "";
  const by = d.source
    ? `Metadata via ${escapeHtml(name)}`
    : `Metadata by <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB</a>`;
  return `<div class="igdb-attr">${link}${by}</div>`;
}
