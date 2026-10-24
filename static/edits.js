"use strict";

/* Writes from the web (see src/edits.py).

   Three surfaces, all admin-only, all optimistic-but-honest:

     * the quick-log strip in the drawer — status, rating, hours, owned, finished;
     * "Add a game", which searches IGDB so the metadata arrives with the pick and
       you only type the columns that are yours (owned, format, what you paid);
     * "Pending edits", the reconciliation list: what hasn't been keyed into the
       spreadsheet yet, what the sheet code for it is, and which edits the sheet
       has since contradicted.

   The spreadsheet is still the source of truth. Every write here lands in a side
   table and is overlaid onto the served rows, so a value you see with the "yours"
   dot is one the workbook doesn't know yet. The server retires an overlay the
   moment the sheet agrees with it — nothing here has to remember to clean up.

   Writes are applied to the in-memory row as well as posted, so the table, the
   facets and the drawer agree immediately; the response carries the coerced value
   (the server owns the sheet's types), and that is what gets stored, not what was
   typed. */

let EDIT_COUNTS = { fields: 0, conflicts: 0, orphans: 0, added: 0 };

// The verbs, in the order you'd reach for them. `col` is a Games-sheet column
// from edits.py's allowlist; anything not on that list is refused server-side.
const STATUS_VALUES = ["Playing", "On Hold", "Up Next"];
const PRIORITY_VALUES = ["Must Play", "Will Play", "Want to Play", "Might Play", "Will Not Play"];

const todayISO = () => new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD, local

/* escapeHtml takes a string and calls .replace on it, so a number throws — and a
   throw inside a template literal that is building innerHTML leaves whatever was
   on screen (a skeleton) there forever, which reads as a hang rather than an
   error. Half the values on this screen come off the API as numbers: a release
   year, a price, a rating. So everything interpolated here goes through esc(). */
const esc = (v) => (v === null || v === undefined ? "" : escapeHtml(String(v)));

function editsSyncCounts() {
  const m = (DATA && DATA.meta && DATA.meta.edits) || null;
  if (m) EDIT_COUNTS = m;
  editsPaintBadge();
}

function editsPaintBadge() {
  const btn = document.querySelector("#navPending");
  if (!btn) return;
  const n = (EDIT_COUNTS.fields || 0) + (EDIT_COUNTS.added || 0);
  const bad = EDIT_COUNTS.conflicts || 0;
  const tag = btn.querySelector(".nav-badge");
  if (tag) {
    tag.textContent = bad ? `${n} · ${bad}!` : (n || "");
    tag.hidden = !n && !bad;
    tag.classList.toggle("warn", !!bad);
  }
}

/* ---- posting ------------------------------------------------------------- */
async function editPost(row, column, value, sheet) {
  sheet = sheet || "games";
  const key = row._k;
  if (!key) { showToast("That row has no match key yet"); return null; }
  let res;
  try {
    res = await fetch("api/edits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, column, value, sheet }),
    });
  } catch (_) {
    showToast("Offline — the edit wasn’t saved");
    return null;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(body.error || "The sheet’s schema refused that value");
    return null;
  }
  // The server coerced it (0.85 from "85", a label from a code), so take ITS value
  // rather than the typed one — otherwise the row on screen and the row in the
  // overlay would disagree about what was written.
  editApplyLocal(row, column, body.value);
  if (body.counts) { EDIT_COUNTS = body.counts; editsPaintBadge(); }
  if (body.rows > 1) showToast(`Saved — ${body.rows} rows share that match key`, "i-edit");
  return body;
}

// Patch the in-memory row the same way the server patched the dataset, including
// the `_edited` marker the UI dots read. The row object here IS the one in
// DATA.sheets, so every view sees it.
function editApplyLocal(row, column, value) {
  if (value === null || value === undefined) delete row[column];
  else row[column] = value;
  const edited = row._edited || (row._edited = []);
  if (!edited.includes(column)) edited.push(column);
  if (typeof renderAll === "function") renderAll();
}

async function editDrop(sheet, key, column) {
  const q = `sheet=${encodeURIComponent(sheet)}&key=${encodeURIComponent(key)}`
    + `&column=${encodeURIComponent(column)}`;
  const res = await fetch(`api/edits?${q}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  if (body.counts) { EDIT_COUNTS = body.counts; editsPaintBadge(); }
  // Put the sheet's own value back on the row in memory too.
  const rows = ((DATA.sheets[sheet] || {}).rows) || [];
  for (const r of rows) {
    if (r._k !== key || r._rowId) continue;
    if (body.state === "pending") editUnapplyLocal(r, column, body.base);
  }
  if (typeof renderAll === "function") renderAll();
  return body;
}

function editUnapplyLocal(row, column, base) {
  if (base === null || base === undefined) delete row[column];
  else row[column] = base;
  if (row._edited) row._edited = row._edited.filter((c) => c !== column);
}

function wireEditsQuick(body, row) {
  if (!body) return;
  const refresh = () => {
    // Repaint the strip so the pressed state, the dots and the dates all follow the
    // write. Cheap: it's one <details> of markup, not the drawer.
    const host = body.querySelector("details.ql");
    if (!host) return;
    const open = host.open;
    host.outerHTML = editsQuickHtml(row);
    const again = body.querySelector("details.ql");
    if (again) { again.open = open; wireEditsQuick(body, row); }
  };
  body.querySelectorAll("[data-ql-set]").forEach((b) => {
    b.onclick = async () => {
      const col = b.dataset.qlSet;
      const val = b.dataset.qlVal;
      // Pressing the value a row already has clears it — one button, both ways.
      const next = (val && row[col] === val) ? null : (val || null);
      b.disabled = true;
      if (await editPost(row, col, next)) refresh(); else b.disabled = false;
    };
  });
  body.querySelectorAll("[data-ql-toggle]").forEach((b) => {
    b.onclick = async () => {
      const col = b.dataset.qlToggle;
      b.disabled = true;
      if (await editPost(row, col, !row[col])) refresh(); else b.disabled = false;
    };
  });
  body.querySelectorAll("[data-ql-today]").forEach((b) => {
    b.onclick = async () => {
      const col = b.dataset.qlToday;
      b.disabled = true;
      if (await editPost(row, col, todayISO())) refresh(); else b.disabled = false;
    };
  });
  body.querySelectorAll("[data-ql-num]").forEach((inp) => {
    const save = async () => {
      const col = inp.dataset.qlNum;
      const scale = +(inp.dataset.qlScale || 1);
      const raw = inp.value.trim();
      const val = raw === "" ? null : +raw / scale;
      if (raw !== "" && !isFinite(val)) return;
      inp.disabled = true;
      const ok = await editPost(row, col, val);
      inp.disabled = false;
      if (ok) refresh();
    };
    inp.onchange = save;
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } };
  });
  const unadd = body.querySelector("[data-ql-unadd]");
  if (unadd) unadd.onclick = async () => {
    if (!confirm("Discard this game? It was never written to the spreadsheet.")) return;
    await editsDiscardAdded(unadd.dataset.qlUnadd);
    if (typeof closeDrawer === "function") closeDrawer();
  };
}

async function editsDiscardAdded(rowId) {
  const res = await fetch(`api/games/${encodeURIComponent(rowId)}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  if (body.counts) { EDIT_COUNTS = body.counts; editsPaintBadge(); }
  for (const sheet of Object.values(DATA.sheets || {})) {
    if (sheet.rows) sheet.rows = sheet.rows.filter((r) => r._rowId !== rowId);
  }
  if (typeof renderAll === "function") renderAll();
  showToast("Discarded", "i-trash");
  return body;
}

/* ---- a modal ------------------------------------------------------------- */
let editDialog = null;

// Distinct values a Games column already uses, most common first — so the add
// form offers the vocabulary this spreadsheet actually speaks instead of inventing
// a new spelling of "Cartridge".
function sheetValues(column, limit) {
  const counts = new Map();
  for (const r of ((DATA.sheets.games || {}).rows) || []) {
    const v = r[column];
    if (typeof v !== "string" || !v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit || 60).map((e) => e[0]);
}

const dlist = (id, values) =>
  `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;

/* ---- menu wiring -------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const add = document.querySelector("#navAddGame");
  if (add) add.onclick = () => { setNav(false); openAddGame(); };
  const pend = document.querySelector("#navPending");
  if (pend) pend.onclick = () => { setNav(false); openPendingEdits(); };
  editsPaintBadge();
});
