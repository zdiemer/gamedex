"use strict";

// UI components for filters.js. Feature state and orchestration remain in that module.

function renderFacets() {
  cancelFacetWork();
  if (!facetsVisible()) return;
  const run = _facetRun, key = facetStateKey(), rows = searchedRows();
  const source = sheet().rows, cols = facetCols();
  const schema = cols.map(col => col.key).join("|");
  const host = $("#facets");
  const current = () => run === _facetRun && facetsVisible()
    && key === facetStateKey() && source === sheet().rows;
  const paint = counts => {
    if (!current()) return;
    const end = typeof gamedexPerf !== "undefined" ? gamedexPerf.start("renderFacets", activeTab) : () => {};
    try { _renderFacets(counts, cols); } finally { host.removeAttribute("aria-busy"); end(); }
  };
  if (_facetResult && _facetResult.rows === rows && _facetResult.key === key && _facetResult.schema === schema) {
    paint(_facetResult.counts);
    return;
  }
  host.setAttribute("aria-busy", "true");
  // On a new tab keep the close control available while the first counts load.
  if (host.dataset.tab !== activeTab) {
    host.replaceChildren();
    const close = document.createElement("button");
    close.className = "facet-close";
    close.textContent = "✕ Close filters";
    close.onclick = () => setFacets(false);
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Loading filters…";
    host.append(close, status);
  }
  const selections = Object.entries(tabState[activeTab].facets)
    .map(([key, values]) => [facetColByKey(key), new Set(values)])
    .filter(([col, values]) => col && values.size);
  const work = countFacetRows(rows, cols, selections, combineOn());
  const enqueue = () => {
    // Nested timers acquire a minimum delay. Hundreds of batches can otherwise
    // take long enough for a background enrichment refresh to restart the count.
    if (typeof scheduler !== "undefined" && scheduler.postTask) scheduler.postTask(step, { priority: "user-visible" });
    else _facetTimer = setTimeout(step, 0);
  };
  const step = () => {
    _facetTimer = null;
    if (!current()) { if (run === _facetRun) renderFacets(); return; }
    const end = typeof gamedexPerf !== "undefined" ? gamedexPerf.start("facetCountChunk", activeTab) : () => {};
    let next;
    try { next = work.next(); } finally { end(); }
    if (next.done) {
      _facetResult = { rows, key, schema, counts: next.value };
      paint(next.value);
    } else enqueue();
  };
  enqueue();
}

function _renderFacets(allCounts, cols) {
  const st = tabState[activeTab];
  const host = $("#facets");

  /* Rebuilding the sidebar empties it, which clamps its scrollTop to 0 — so every
     checkbox click flung you back to the top, and even restoring the old scrollTop
     wouldn't help: groups above you appear and vanish as their counts hit zero, so
     the same pixel lands somewhere else. Anchor to a GROUP instead: remember which
     group sits at the container's top edge (and how far above it the edge cuts),
     rebuild, then scroll so that group sits exactly where it was. The group you're
     editing keeps still under your cursor no matter what the recount did above it.
     Only within a tab — landing on a fresh tab's sidebar should start at the top. */
  let anchorKey = null, anchorDelta = 0;
  const tabChanged = host.dataset.tab !== activeTab;
  const hostTop = host.getBoundingClientRect().top;
  if (!tabChanged && host.scrollTop > 0) {
    const g = [...host.querySelectorAll(".facet")]
      .find((el) => el.getBoundingClientRect().bottom > hostTop + 1);
    if (g) { anchorKey = g.dataset.key; anchorDelta = g.getBoundingClientRect().top - hostTop; }
  }
  // The toggled checkbox is destroyed with everything else; without this a keyboard
  // user's focus falls to <body> after every space-toggle.
  let refocus = null;
  const ae = document.activeElement;
  if (ae && ae.type === "checkbox" && host.contains(ae)) {
    const opt = ae.closest(".facet-opt"), grp = ae.closest(".facet");
    if (opt && grp) refocus = { key: grp.dataset.key, val: opt.dataset.val };
  }

  let searchFocus = null;
  if (ae && ae.classList.contains("facet-filter") && host.contains(ae)) {
    searchFocus = { key: ae.closest(".facet").dataset.key, start: ae.selectionStart, end: ae.selectionEnd };
  }

  host.innerHTML = "";

  const closeBtn = document.createElement("button");   // mobile-only (CSS)
  closeBtn.className = "facet-close";
  closeBtn.textContent = "✕ Close filters";
  closeBtn.onclick = () => setFacets(false);
  host.appendChild(closeBtn);

  for (const col of cols) {
    const counts = new Map(allCounts.get(col.key));
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
    } else if (valueOrderOf(col)) {
      // A scale rather than a set (Priority) — list it in its own order. Count would put
      // "Might Play" above "Must Play" for no reason other than there being more of them.
      const rank = valueOrderOf(col);
      values.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
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
    group.dataset.key = col.key;                 // the scroll anchor's identity

    const head = document.createElement("div");
    head.className = "facet-head";
    const nSel = selected.size ? ` (${selected.size})` : "";
    head.innerHTML = `<span>${escapeHtml(col.label)}${nSel}</span><span class="chev">▼</span>`;
    head.onclick = () => {
      st.expanded[col.key] = st.expanded[col.key] === false;
      group.classList.toggle("collapsed", st.expanded[col.key] === false);
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
        opt.dataset.val = v.key;                 // for refocusing after a rebuild
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

  host.dataset.tab = activeTab;
  // A fresh tab's sidebar starts at the top — the browser happily carries the old
  // tab's scroll depth through the rebuild otherwise.
  if (tabChanged) host.scrollTop = 0;
  else if (anchorKey) {
    const g = [...host.querySelectorAll(".facet")].find((el) => el.dataset.key === anchorKey);
    // Nudge by how far the group MOVED, not to an absolute position: whether the
    // browser kept the old scrollTop through the rebuild (same-task, no layout) or
    // clamped it to 0, the relative form lands the group back under the same cut.
    if (g) host.scrollTop += (g.getBoundingClientRect().top - host.getBoundingClientRect().top) - anchorDelta;
  }
  if (refocus) {
    const opt = [...host.querySelectorAll(".facet-opt")].find(
      (el) => el.dataset.val === refocus.val && el.closest(".facet").dataset.key === refocus.key);
    const input = opt && opt.querySelector("input");
    if (input) input.focus({ preventScroll: true });
  }
  if (searchFocus) {
    const group = [...host.querySelectorAll(".facet")].find(el => el.dataset.key === searchFocus.key);
    const input = group && group.querySelector(".facet-filter");
    if (input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(searchFocus.start, searchFocus.end);
    }
  }

}
