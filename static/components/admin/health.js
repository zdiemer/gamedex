"use strict";

// UI components for health.js. Feature state and orchestration remain in that module.

function healthRowHtml(check, r, i) {
  const title = String(r.title || r.game || "");
  const bits = [r.platform, r.releaseYear].filter((x) => x != null && x !== "")
    .map((x) => escapeHtml(String(x))).join(" · ");
  const extra = check.detail ? check.detail(r) : "";
  return `<button class="hz-row" data-hc="${check.id}" data-hi="${i}">
    <span class="hz-row-t">${escapeHtml(title)}</span>
    <span class="hz-row-m">${bits}</span>
    ${extra ? `<span class="hz-row-x">${escapeHtml(extra)}</span>` : ""}
  </button>`;
}

// rows per page

/* The list used to stop dead at 40 with "Showing the first 40 of 153" and no way to reach
   the other 113 — which is useless precisely when a check finds a lot, i.e. when you sit
   down to work through them. Paged now, and the page is remembered per check: fix a mapping,
   come back, and you're still on the page you were on rather than back at the top. */
function healthPager(id, total, page) {
  const pages = Math.ceil(total / HZ_SHOWN);
  if (pages <= 1) return "";
  const from = page * HZ_SHOWN + 1;
  const to = Math.min(total, (page + 1) * HZ_SHOWN);
  return `<div class="hz-pager">
    <button class="hz-pg" data-hp="${id}" data-hpn="${page - 1}" ${page === 0 ? "disabled" : ""}>‹ Prev</button>
    <span class="hz-pg-n">${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}
      <span class="muted">· page ${page + 1} of ${pages}</span></span>
    <button class="hz-pg" data-hp="${id}" data-hpn="${page + 1}" ${page >= pages - 1 ? "disabled" : ""}>Next ›</button>
  </div>`;
}

function hzMatchDashboard() {
  const s = typeof ENRICH_STATS !== "undefined" && ENRICH_STATS;
  if (!s || !s.total) return "";
  const pill = (label, matched) =>
    `<span class="hz-pill hz-match">${escapeHtml(label)} <b>${(matched || 0).toLocaleString()}</b></span>`;
  const pills = [pill("IGDB", s.matched)];
  for (const [key, src] of Object.entries(s.sources || {})) {
    pills.push(pill(HZ_SOURCE_LABEL[key] || key, src.matched));
  }
  let queued = s.queued || 0;
  for (const src of Object.values(s.sources || {})) queued += src.queued || 0;
  return `<div class="hz-matches">
    <h2>Metadata matches <span class="muted">of ${s.total.toLocaleString()} games${
      queued ? ` · ${queued.toLocaleString()} queued` : ""}</span></h2>
    <div class="hz-summary">${pills.join("")}</div>
  </div>`;
}

function renderHealth() {
  const host = $("#health");
  if (!DATA) return;
  const results = healthResults();
  const errs = results.filter((x) => x.c.severity === "error" && x.rows.length).length;
  const warns = results.filter((x) => x.c.severity === "warn" && x.rows.length).length;
  const total = results.reduce((a, x) => a + x.rows.length, 0);

  host.innerHTML =
    `<div class="hz-head">
      <h1>Data health</h1>
      <p>${total.toLocaleString()} entries across ${results.filter((x) => x.rows.length).length} checks want a second look.
         Fix them at the source and they'll clear on the next refresh.</p>
      <div class="hz-summary">
        <span class="hz-pill sev-error">${errs} error${errs !== 1 ? "s" : ""}</span>
        <span class="hz-pill sev-warn">${warns} warning${warns !== 1 ? "s" : ""}</span>
        <span class="hz-pill sev-info">${results.filter((x) => x.c.severity === "info" && x.rows.length).length} gaps</span>
      </div>
      ${hzMatchDashboard()}
    </div>
    <div class="hz-list">` +
    results.map(({ c, rows }) => {
      const open = healthState.open === c.id;
      const sev = SEV[c.severity];
      return `<section class="hz-check${rows.length ? "" : " clean"}${open ? " open" : ""}">
        <button class="hz-check-head" data-toggle="${c.id}">
          <span class="hz-pill ${sev.cls}">${sev.label}</span>
          <span class="hz-check-t">${escapeHtml(c.title)}</span>
          <span class="hz-count">${rows.length ? rows.length.toLocaleString() : "✓ clean"}</span>
          <span class="hz-caret">${open ? "▾" : "▸"}</span>
        </button>
        ${open ? (() => {
          // Clamp: the row count shrinks as you fix things, and page 4 of a check that now
          // has two pages must not render an empty list.
          const pages = Math.max(1, Math.ceil(rows.length / HZ_SHOWN));
          const page = Math.min(healthState.page[c.id] || 0, pages - 1);
          healthState.page[c.id] = page;
          const start = page * HZ_SHOWN;
          return `<div class="hz-body">
            <p class="hz-why">${escapeHtml(c.why)}</p>
            <div class="hz-rows">${rows.slice(start, start + HZ_SHOWN)
              // The index must be ABSOLUTE — the click handler looks the row up in the full
              // list, so a page-relative one would open the wrong game from page two on.
              .map((r, i) => healthRowHtml(c, r, start + i)).join("")}</div>
            ${healthPager(c.id, rows.length, page)}
          </div>`;
        })() : ""}
      </section>`;
    }).join("") + `</div>`;

  host.querySelectorAll("[data-toggle]").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.toggle;
      const wasOpen = healthState.open === id;
      healthState.open = wasOpen ? null : id;
      if (!wasOpen) healthState.page[id] = 0;      // a fresh open starts at the top
      renderHealth();
    };
  });
  host.querySelectorAll("[data-hp]").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      healthState.page[el.dataset.hp] = Math.max(0, +el.dataset.hpn);
      renderHealth();
      // Keep the check you're paging through under the cursor, rather than leaving you
      // halfway down a list that just changed under you.
      const sec = host.querySelector(".hz-check.open");
      if (sec) sec.scrollIntoView({ block: "nearest" });
    };
  });
  host.querySelectorAll("[data-hc]").forEach((el) => {
    el.onclick = () => {
      const res = healthResults().find((x) => x.c.id === el.dataset.hc);
      if (!res) return;
      const row = res.rows[+el.dataset.hi];
      if (row) openDrawer(row, res.c.sheet);
    };
  });
}
