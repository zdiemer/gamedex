"use strict";

/* Turning search text + ticked facets into a row list, and painting the sidebar.

   Search folds diacritics and caches its haystack per row, because filtering
   14.7k rows runs on every keystroke. The facet counts are computed against the
   rows that pass every OTHER facet, so a count never reads as zero for something
   you can plainly still click. */

// ---- filtering ----------------------------------------------------------
// Fold text for search: lowercase AND strip diacritics, so "pokemon" matches
// "Pokémon" and "naive" matches "naïve". NFD splits an accented letter into its
// base + a combining mark; we drop the marks. Applied to both haystack and query
// so the two always meet in the same alphabet.
const foldText = (s) => String(s).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
// Row matches free-text search.
// The searchable text of a row, built once and kept. A WeakMap keyed on the row
// object means a fresh spreadsheet invalidates it for free.
const HAYSTACK = new WeakMap();
function rowHaystack(row, cols) {
  let hay = HAYSTACK.get(row);
  if (hay === undefined) {
    hay = foldText(cols.map((k) => row[k]).filter((v) => v != null).join(" "));
    HAYSTACK.set(row, hay);
  }
  return hay;
}
// IGDB genres are searchable too — so "Platformer" finds games IGDB tagged Platform,
// not only the ones your sheet spells that way. Kept separate from rowHaystack (which is
// sheet-only and immutable) and re-derived when enrichment lands, since ENRICH fills in
// after the first paint. Cheap: unmatched rows return "" without touching the vocab.
let _enrichEpoch = 0;
const _genreHay = new WeakMap();
function searchGenreHay(row) {
  if (!ENRICH_ENABLED || !ENRICH[row._k]) return "";
  const c = _genreHay.get(row);
  if (c && c.e === _enrichEpoch) return c.h;
  const h = foldText(unifiedGenreVals(row).join(" "));
  _genreHay.set(row, { e: _enrichEpoch, h });
  return h;
}
function matchesSearch(row, terms, cols) {
  if (!terms.length) return true;
  const hay = rowHaystack(row, cols);
  return terms.every((t) => hay.includes(t) || searchGenreHay(row).includes(t));
}
// Row matches a facet selection (Set of value keys). OR within a facet; for
// IGDB array facets a row matches if ANY of its values is selected.
function matchesFacet(row, col, selected) {
  if (!selected || selected.size === 0) return true;
  return rowFacetItems(row, col).some((it) => selected.has(it.key));
}

// The search half of the filter, memoised. renderFacets() calls filterRows once
// per facet column (20+ times) and the search term is the same for every one of
// them, so scanning the sheet each time was pure waste.
let _searchBase = { tab: null, q: null, rows: null };
function searchedRows() {
  const st = tabState[activeTab];
  if (_searchBase.tab === activeTab && _searchBase.q === st.search) return _searchBase.rows;
  const terms = foldText(st.search).split(/\s+/).filter(Boolean);
  const sCols = searchCols();
  const rows = terms.length
    ? sheet().rows.filter((row) => matchesSearch(row, terms, sCols))
    : sheet().rows;
  _searchBase = { tab: activeTab, q: st.search, rows };
  return rows;
}
const resetSearchCache = () => { _searchBase = { tab: null, q: null, rows: null }; };

// Rows matching search + every facet EXCEPT `skipKey` (for facet counts) or all.
// Callers never mutate the result (sortRows copies), so the no-facet case can
// hand back the memoised array as-is.
function filterRows(skipKey) {
  const st = tabState[activeTab];
  const active = Object.keys(st.facets)
    .map((k) => [facetColByKey(k), st.facets[k]])
    .filter(([c]) => c && c.key !== skipKey && st.facets[c.key] && st.facets[c.key].size);
  const base = searchedRows();
  if (!active.length) return base;
  return base.filter((row) => {
    for (const [col, sel] of active) {
      if (!matchesFacet(row, col, sel)) return false;
    }
    return true;
  });
}

// ---- rendering: facets --------------------------------------------------
function setFacets(open) {
  $("#facets").classList.toggle("open", open);
  $("#facetBackdrop").hidden = !open;
  syncScrollLock();
}

function renderFacets() {
  const st = tabState[activeTab];
  const host = $("#facets");
  host.innerHTML = "";

  const closeBtn = document.createElement("button");   // mobile-only (CSS)
  closeBtn.className = "facet-close";
  closeBtn.textContent = "✕ Close filters";
  closeBtn.onclick = () => setFacets(false);
  host.appendChild(closeBtn);

  for (const col of facetCols()) {
    // Count values across rows filtered by the OTHER facets + search.
    const base = filterRows(col.key);
    const counts = new Map();
    for (const row of base) {
      for (const it of rowFacetItems(row, col)) {
        counts.set(it.key, (counts.get(it.key) || 0) + 1);
      }
    }
    const selected = st.facets[col.key] || new Set();
    // Always include selected values even if their current count is 0.
    for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
    if (counts.size === 0) continue;

    let values = [...counts.entries()].map(([k, n]) => ({
      key: k,
      label: facetLabel(col, col.type === "bool" ? k === "true" : k),
      count: n,
    }));
    if (col.buckets) {                                   // fixed bucket order
      const ord = new Map(col.buckets.map((b, i) => [b.label, i]));
      values.sort((a, b) => (ord.get(a.key) ?? 99) - (ord.get(b.key) ?? 99));
    } else if (col.type === "bool") {
      values.sort((a, b) => (a.key === "true" ? 0 : 1) - (b.key === "true" ? 0 : 1));   // Yes before No
    } else {
      const numeric = col.type === "year" || col.type === "int" || col.type === "number";
      // For year facets, non-numeric labels (e.g. "Early Access") sort as newest.
      const nkey = (k) => { const n = Number(k); return isNaN(n) ? Infinity : n; };
      values.sort((a, b) =>
        numeric ? nkey(b.key) - nkey(a.key) : b.count - a.count || a.label.localeCompare(b.label)
      );
    }

    const group = document.createElement("div");
    group.className = "facet" + (st.expanded[col.key] === false ? " collapsed" : "");

    const head = document.createElement("div");
    head.className = "facet-head";
    const nSel = selected.size ? ` (${selected.size})` : "";
    head.innerHTML = `<span>${escapeHtml(col.label)}${nSel}</span><span class="chev">▼</span>`;
    head.onclick = () => {
      st.expanded[col.key] = st.expanded[col.key] === false;
      renderFacets();
    };
    group.appendChild(head);

    const body = document.createElement("div");
    body.className = "facet-body";

    const filterKey = "__f_" + col.key;
    const showAll = st.expanded[filterKey + "_all"];
    let filterText = st.expanded[filterKey] || "";
    // The options list is rebuilt on its own when you type in the filter box —
    // never via renderFacets(). Re-rendering the whole sidebar recomputed the
    // counts for every column (the expensive part), and worse, it destroyed the
    // input you were typing into: the old code then "restored focus" by querying
    // the DETACHED group element, which finds the old input and focuses nothing.
    // Keeping the input alive means focus and caret survive for free.
    const optionsBox = document.createElement("div");
    optionsBox.className = "facet-options";

    const paintOptions = () => {
      optionsBox.innerHTML = "";
      const q = (st.expanded[filterKey] || "").toLowerCase();
      const shown = q ? values.filter((v) => v.label.toLowerCase().includes(q)) : values;
      const seeAll = st.expanded[filterKey + "_all"];
      const capped = !seeAll && !q && shown.length > FACET_CAP;
      const visible = capped ? shown.slice(0, FACET_CAP) : shown;

      for (const v of visible) {
        const opt = document.createElement("label");
        const isChecked = selected.has(v.key);
        opt.className = "facet-opt" + (isChecked ? " checked" : "");
        opt.innerHTML =
          `<input type="checkbox" ${isChecked ? "checked" : ""}/>` +
          `<span class="lbl" title="${escapeHtml(v.label)}">${escapeHtml(v.label)}</span>` +
          `<span class="cnt">${v.count.toLocaleString()}</span>`;
        opt.querySelector("input").onchange = () => {
          const set = st.facets[col.key] || new Set();
          if (set.has(v.key)) set.delete(v.key);
          else set.add(v.key);
          if (set.size) st.facets[col.key] = set;
          else delete st.facets[col.key];
          st.page = 1;
          renderAll();
          nav();
        };
        optionsBox.appendChild(opt);
      }

      if (!visible.length) {
        const none = document.createElement("div");
        none.className = "facet-none";
        none.textContent = "No matches";
        optionsBox.appendChild(none);
      }
      if (capped) {
        const more = document.createElement("button");
        more.className = "facet-more";
        more.textContent = `Show ${shown.length - FACET_CAP} more…`;
        more.onclick = () => { st.expanded[filterKey + "_all"] = true; paintOptions(); };
        optionsBox.appendChild(more);
      } else if (seeAll && shown.length > FACET_CAP && !q) {
        const less = document.createElement("button");
        less.className = "facet-more";
        less.textContent = "Show less";
        less.onclick = () => { st.expanded[filterKey + "_all"] = false; paintOptions(); };
        optionsBox.appendChild(less);
      }
    };

    if (values.length > FACET_FILTER_THRESHOLD) {
      const fi = document.createElement("input");
      fi.className = "facet-filter";
      fi.type = "search";
      fi.placeholder = `Filter ${col.label.toLowerCase()}…`;
      fi.value = filterText;
      fi.oninput = () => {
        st.expanded[filterKey] = fi.value;
        paintOptions();          // this group only; the input is never replaced
      };
      // Same field as every other search box: icon inside, one focus ring.
      const fwrap = document.createElement("span");
      fwrap.className = "field field-facet";
      fwrap.innerHTML = `<svg class="ico" width="13" height="13" aria-hidden="true"><use href="#i-search"/></svg>`;
      fwrap.appendChild(fi);
      body.appendChild(fwrap);
    }

    paintOptions();
    body.appendChild(optionsBox);

    group.appendChild(body);
    host.appendChild(group);
  }
}
