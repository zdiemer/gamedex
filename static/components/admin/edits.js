"use strict";

// UI components for edits.js. Feature state and orchestration remain in that module.

/* ---- the drawer's quick-log strip ---------------------------------------- */
// Only the Games sheet: the verbs are about a copy you own and are playing.
// Grouped cards have no single row to write to, and a wishlist/recommendation row
// isn't in the collection at all.
function editsQuickHtml(row) {
  if (typeof IS_ADMIN === "undefined" || !IS_ADMIN) return "";
  if (!row || !row._k || row._collection || row._wlOnly) return "";
  if ((drawerSheet || "games") !== "games") return "";
  // A grouped card is several platform copies under one title, and a cell belongs to
  // exactly one of them. Say so rather than silently offering nothing — the copies
  // are listed further down this same drawer.
  if (row._members && row._members.length > 1)
    return `<div class="ql ql-grouped muted">${icon("i-edit", 12)} Open a single copy below
      to log status, hours or a rating against it.</div>`;
  const on = (col, val) => (row[col] === val ? " on" : "");
  const mine = (col) => ((row._edited || []).includes(col) ? ` <i class="ql-dot" title="Not in the spreadsheet yet"></i>` : "");
  const seg = (col, values) => values.map((v) =>
    `<button class="ce-opt${on(col, v)}" data-ql-set="${col}" data-ql-val="${esc(v)}">${esc(v)}</button>`).join("");
  const pct = row.rating != null ? Math.round(row.rating * 100) : "";
  return `<details class="ql" ${row._added ? "open" : ""}>
    <summary>${icon("i-edit", 13)} Quick log${mine("playingStatus")}</summary>
    <div class="ql-body">
      <div class="ql-row"><label>Status</label>
        <div class="ce-seg">${seg("playingStatus", STATUS_VALUES)}
          <button class="ce-opt" data-ql-set="playingStatus" data-ql-val="">Clear</button></div></div>
      <div class="ql-row"><label>Priority</label>
        <div class="ce-seg">${seg("priority", PRIORITY_VALUES)}</div></div>
      <div class="ql-row"><label>Mine</label>
        <div class="ce-seg">
          <button class="ce-opt${row.owned ? " on" : ""}" data-ql-toggle="owned">Owned${mine("owned")}</button>
          <button class="ce-opt${row.completed ? " on" : ""}" data-ql-toggle="completed">Completed${mine("completed")}</button>
          <button class="ce-opt${row.wishlisted ? " on" : ""}" data-ql-toggle="wishlisted">Wishlisted</button>
        </div></div>
      <div class="ql-row"><label>Rating${mine("rating")}</label>
        <span class="field field-inline"><input type="number" min="0" max="100" step="1"
          placeholder="—" value="${pct}" data-ql-num="rating" data-ql-scale="100"><b>%</b></span></div>
      <div class="ql-row"><label>Hours${mine("completionTime")}</label>
        <span class="field field-inline"><input type="number" min="0" step="0.25"
          placeholder="—" value="${row.completionTime ?? ""}" data-ql-num="completionTime"><b>h</b></span></div>
      <div class="ql-row"><label>Dates</label>
        <div class="ce-seg">
          <button class="ce-opt" data-ql-today="dateStarted">Started today</button>
          <button class="ce-opt" data-ql-today="dateCompleted">Finished today</button>
        </div>
        <span class="ql-dates muted">${[["Started", row.dateStarted], ["Finished", row.dateCompleted]]
          .filter(([, v]) => v).map(([l, v]) => `${l} ${esc(fmtDate(v))}`).join(" · ")}</span></div>
      ${row._rowId ? `<div class="ql-note muted">This game was added here and isn’t in the
        spreadsheet yet — ${icon("i-edit", 11)} its cells live in the overlay.
        <button class="linkbtn danger" data-ql-unadd="${esc(row._rowId)}">Discard it</button></div>` : ""}
    </div></details>`;
}

function editsModal(title, inner, cls) {
  editDialog?.close();
  editDialog = openUiDialog({
    className: `ed ${cls || ""}`, panelClass: "ed-ce", label: title,
    html: `<h3>${esc(title)}</h3><div class="ed-body"></div>`,
    onClose: () => { editDialog = null; },
  });
  const { host, close } = editDialog;
  const body = host.querySelector(".ed-body");
  body.innerHTML = inner;
  return { host, close, body };
}

/* ---- add a game --------------------------------------------------------- */
function openAddGame(prefill) {
  if (typeof IS_ADMIN === "undefined" || !IS_ADMIN) return;
  const m = editsModal("Add a game", `
    <p class="ce-sub">Search IGDB for the game, then fill in the columns only you know.
      It lands in the collection straight away and is staged until you key it into the
      spreadsheet.</p>
    <div class="ed-search">
      <span class="field field-inline">
        ${icon("i-search", 14)}
        <input id="agQ" type="search" placeholder="Title…" autocomplete="off" spellcheck="false"
               value="${esc(prefill || "")}">
      </span>
      <button class="btn" id="agGo">Search</button>
    </div>
    <div id="agResults" class="ed-results"></div>
    <div id="agForm"></div>`, "ed-wide");

  const q = m.body.querySelector("#agQ");
  const results = m.body.querySelector("#agResults");
  const formHost = m.body.querySelector("#agForm");
  let seq = 0;

  const search = async () => {
    const term = q.value.trim();
    if (term.length < 2) return;
    const mine = ++seq;
    results.innerHTML = `<div class="skel skel-line"></div><div class="skel skel-line"></div>`;
    formHost.innerHTML = "";
    let body;
    try {
      const res = await fetch(`api/igdb/search?q=${encodeURIComponent(term)}`);
      body = await res.json();
      if (!res.ok) throw new Error(body.error || "search failed");
    } catch (err) {
      if (mine === seq) results.innerHTML = `<div class="muted">${esc(String(err.message || err))}</div>`;
      return;
    }
    if (mine !== seq) return;                       // a later search already answered
    if (!body.results.length) {
      results.innerHTML = `<div class="muted">Nothing on IGDB for “${esc(term)}”.
        You can still <button class="linkbtn" id="agManual">add it by hand</button>.</div>`;
      const manual = results.querySelector("#agManual");
      if (manual) manual.onclick = () => showAddForm(null, { title: term });
      return;
    }
    results.innerHTML = body.results.map((r, i) => `
      <button class="ed-hit" data-i="${i}">
        ${r.cover ? `<img src="${esc(IMG(r.cover, "cover_small"))}" alt="" loading="lazy">`
                  : `<span class="ed-nocover">${icon("i-library", 16)}</span>`}
        <span class="ed-hit-t"><b>${esc(r.name || "")}</b>
          <em>${[r.year, r.status, (r.platforms || []).map((p) => p.sheet || p.igdb).slice(0, 4).join(", ")]
            .filter(Boolean).map(esc).join(" · ")}</em></span>
      </button>`).join("");
    results.querySelectorAll(".ed-hit").forEach((b) => {
      b.onclick = () => {
        results.querySelectorAll(".ed-hit").forEach((x) => x.classList.toggle("on", x === b));
        showAddForm(body.results[+b.dataset.i]);
      };
    });
  };

  function showAddForm(hit, manual) {
    const f = (hit && hit.fields) || manual || {};
    // Platforms the game actually shipped on, with the sheet's own name where we
    // could map it; then every platform the sheet already uses, because IGDB's list
    // can miss a release (and this is the field a wrong guess ruins).
    const offered = (hit && hit.platforms || []).map((p) => p.sheet).filter(Boolean);
    const all = sheetValues("platform", 200);
    const platforms = [...new Set([...offered, ...all])];
    const textRow = (label, name, value, extra) =>
      `<label class="ed-f"><span>${esc(label)}</span>
        <input name="${name}" value="${esc(value ?? "")}" ${extra || ""}></label>`;
    const selRow = (label, name, values, value) =>
      `<label class="ed-f"><span>${esc(label)}</span>
        <select name="${name}"><option value=""></option>
        ${values.map((v) => `<option${v === value ? " selected" : ""}>${esc(v)}</option>`).join("")}
        </select></label>`;
    formHost.innerHTML = `
      <h4 class="ed-h">${esc(f.title || "New game")}${hit ? ` <span class="muted">· IGDB ${hit.igdbId}</span>` : ` <span class="muted">· no IGDB match</span>`}</h4>
      <div class="ed-grid">
        ${textRow("Title", "title", f.title)}
        <label class="ed-f"><span>Platform *</span>
          <input name="platform" list="agPlat" value="${esc(platforms.includes(offered[0]) ? offered[0] : "")}"
                 placeholder="${esc(offered[0] || "e.g. " + (all[0] || "PC"))}"></label>
        ${dlist("agPlat", platforms)}
        ${textRow("Release date", "releaseDate", f.releaseDate, 'placeholder="YYYY-MM-DD"')}
        ${textRow("Release year", "releaseYear", f.releaseYear)}
        ${textRow("Genre", "genre", f.genre, 'list="agGenre"')}
        ${dlist("agGenre", sheetValues("genre"))}
        ${textRow("Franchise", "franchise", f.franchise, 'list="agFran"')}
        ${dlist("agFran", sheetValues("franchise", 200))}
        ${textRow("Publisher", "publisher", f.publisher, 'list="agPub"')}
        ${dlist("agPub", sheetValues("publisher", 200))}
        ${textRow("Developer", "developer", f.developer, 'list="agDev"')}
        ${dlist("agDev", sheetValues("developer", 200))}
        ${textRow("Region", "releaseRegion", "", 'list="agRegion"')}
        ${dlist("agRegion", sheetValues("releaseRegion"))}
      </div>
      <h4 class="ed-h">Yours</h4>
      <div class="ed-grid">
        ${textRow("Format", "format", "", 'list="agFormat"')}
        ${dlist("agFormat", sheetValues("format"))}
        ${textRow("Condition", "condition", "", 'list="agCond"')}
        ${dlist("agCond", sheetValues("condition"))}
        ${textRow("Paid", "purchasePrice", "", 'type="number" min="0" step="0.01"')}
        ${textRow("Bought on", "datePurchased", "", 'type="date"')}
        ${textRow("Added on", "dateAdded", todayISO(), 'type="date"')}
        ${selRow("Status", "playingStatus", STATUS_VALUES)}
        ${selRow("Priority", "priority", PRIORITY_VALUES)}
        ${textRow("Rating %", "rating", "", 'type="number" min="0" max="100" step="1"')}
        ${textRow("Hours", "completionTime", "", 'type="number" min="0" step="0.25"')}
        <label class="ed-f ed-checks"><span>Flags</span><span>
          <label><input type="checkbox" name="owned" checked> Owned</label>
          <label><input type="checkbox" name="completed"> Completed</label>
          <label><input type="checkbox" name="wishlisted"> Wishlisted</label>
        </span></label>
      </div>
      <label class="ed-f ed-wide-f"><span>Notes</span>
        <textarea name="notes" rows="2" placeholder="Boutique label, edition, “Two copies owned”…"></textarea></label>
      <p class="ed-err" id="agErr" hidden></p>
      <div class="ce-acts"><span class="muted ed-foot">${hit
        ? "IGDB’s record is pinned to this row, so every other source matches from it."
        : "No IGDB record, so the other sources will try to match it by title."}</span>
        <div class="ce-right"><button class="sh-btn" id="agCancel">Cancel</button>
        <button class="btn" id="agSave">Add to collection</button></div></div>`;

    formHost.querySelector("#agCancel").onclick = m.close;
    const err = formHost.querySelector("#agErr");
    formHost.querySelector("#agSave").onclick = async () => {
      const get = (n) => (formHost.querySelector(`[name="${n}"]`) || {}).value;
      const checked = (n) => !!(formHost.querySelector(`[name="${n}"]`) || {}).checked;
      const platform = (get("platform") || "").trim();
      if (!platform) {
        err.hidden = false; err.textContent = "Pick a platform — the sheet keeps one row per copy.";
        return;
      }
      const num = (n) => { const v = (get(n) || "").trim(); return v === "" ? null : +v; };
      const text = (n) => { const v = (get(n) || "").trim(); return v || null; };
      const pct = num("rating");
      const fields = {
        title: text("title"), releaseDate: text("releaseDate"), releaseYear: num("releaseYear"),
        genre: text("genre"), franchise: text("franchise"), publisher: text("publisher"),
        developer: text("developer"), releaseRegion: text("releaseRegion"),
        format: text("format"), condition: text("condition"),
        purchasePrice: num("purchasePrice"), datePurchased: text("datePurchased"),
        dateAdded: text("dateAdded"), playingStatus: text("playingStatus"),
        priority: text("priority"), completionTime: num("completionTime"),
        notes: text("notes"),
        owned: checked("owned"), completed: checked("completed"), wishlisted: checked("wishlisted"),
        // The sheet stores a 0..1 fraction; the form asks for the percent you'd say out loud.
        rating: pct == null ? null : pct / 100,
      };
      const save = formHost.querySelector("#agSave");
      save.disabled = true; save.textContent = "Adding…"; err.hidden = true;
      let body, res;
      try {
        res = await fetch("api/games", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ igdbId: hit ? hit.igdbId : null, platform, sheet: "games", fields }),
        });
        body = await res.json();
      } catch (_) {
        save.disabled = false; save.textContent = "Add to collection";
        err.hidden = false; err.textContent = "Offline — nothing was saved.";
        return;
      }
      if (!res.ok) {
        save.disabled = false; save.textContent = "Add to collection";
        err.hidden = false; err.textContent = body.error || "That didn’t go in.";
        return;
      }
      // Put it in the live dataset so it's searchable and faceted without a reload,
      // shaped exactly like the row the server injected.
      const row = { ...body.fields, _rowId: body.rowId, _added: true, _k: body.matchKey };
      ((DATA.sheets.games || {}).rows || []).push(row);
      if (body.counts) { EDIT_COUNTS = body.counts; editsPaintBadge(); }
      m.close();
      if (typeof renderAll === "function") renderAll();
      showToast(body.igdbPinned ? "Added — IGDB pinned, other sources matching" : "Added", "i-check");
      // Straight into its drawer: the next thing you want is to see what came back.
      if (typeof openDrawer === "function") openDrawer(row, "games");
    };
  }

  m.body.querySelector("#agGo").onclick = search;
  q.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } };
  q.focus();
  if (prefill) search();
}

/* ---- pending edits ------------------------------------------------------ */
function openPendingEdits() {
  if (typeof IS_ADMIN === "undefined" || !IS_ADMIN) return;
  const m = editsModal("Pending edits", `<div class="muted">Loading…</div>`, "ed-wide");
  const render = async () => {
    let body;
    try {
      const res = await fetch("api/edits");
      body = await res.json();
      if (!res.ok) throw new Error(body.error || "couldn’t load");
    } catch (err) {
      m.body.innerHTML = `<div class="muted">${esc(String(err.message || err))}</div>`;
      return;
    }
    EDIT_COUNTS = body.counts || EDIT_COUNTS;
    editsPaintBadge();
    const titleOf = (sheet, key) => {
      const rows = ((DATA.sheets[sheet] || {}).rows) || [];
      const r = rows.find((x) => x._k === key);
      if (!r) return key;
      const t = r.title || r.game || key;
      return [t, r.platform].filter(Boolean).join(" · ");
    };
    const labelOf = (sheet, col) => {
      const cols = ((DATA.sheets[sheet] || {}).columns) || [];
      const c = cols.find((x) => x.key === col);
      return c ? c.label : col;
    };
    const typeOf = (sheet, col) => {
      const cols = ((DATA.sheets[sheet] || {}).columns) || [];
      const c = cols.find((x) => x.key === col);
      return c ? c.type : "text";
    };
    const show = (sheet, col, v) =>
      v === null || v === undefined ? `<span class="muted">(empty)</span>` : fmtCell(v, typeOf(sheet, col));

    const conflicts = body.fields.filter((f) => f.state === "conflict");
    const orphans = body.fields.filter((f) => f.state === "orphan");
    const plain = body.fields.filter((f) => f.state === "pending");

    const fieldRow = (f) => `<div class="ed-pend" data-sheet="${esc(f.sheet)}"
        data-key="${esc(f.matchKey)}" data-col="${esc(f.column)}">
      <div class="ed-pend-t"><b>${esc(titleOf(f.sheet, f.matchKey))}</b>
        <em>${esc(labelOf(f.sheet, f.column))}</em></div>
      <div class="ed-pend-v">
        ${f.state === "conflict"
          ? `<span class="ed-vs"><span>sheet now</span>${show(f.sheet, f.column, f.sheetValue)}</span>
             <span class="ed-vs"><span>yours</span>${show(f.sheet, f.column, f.value)}</span>`
          : `<span class="ed-vs"><span>was</span>${show(f.sheet, f.column, f.base)}</span>
             <span class="ed-vs"><span>now</span>${show(f.sheet, f.column, f.value)}</span>`}
        ${f.sheetCode ? `<span class="ed-code" title="What to type into the spreadsheet cell">type <b>${esc(f.sheetCode)}</b></span>` : ""}
      </div>
      <div class="ed-pend-a">
        ${f.state === "conflict" ? `<button class="linkbtn" data-keep>Keep mine</button>` : ""}
        <button class="linkbtn danger" data-drop>${f.state === "conflict" ? "Take the sheet’s" : "Discard"}</button>
      </div></div>`;

    const addedRow = (a) => {
      const fields = a.fields || {};
      const title = fields.title || fields.game || a.rowId;
      const enriched = (typeof ENRICH !== "undefined" && a.matchKey && ENRICH[a.matchKey]) || {};
      const igdbUrl = a.igdbUrl || enriched.url
        || `https://www.igdb.com/search?type=1&q=${encodeURIComponent(title)}`;
      const metadata = [
        ["Platform", fields.platform],
        ["Release date", fields.releaseDate || fields.releaseYear],
        ["Developer", fields.developer],
        ["Publisher", fields.publisher],
        ["Franchise / series", fields.franchise],
        ["Genre", fields.genre],
      ];
      return `<div class="ed-pend ed-pend-added" data-row="${esc(a.rowId)}">
      <div class="ed-pend-t"><b>${esc(title)}</b>
        <em>New spreadsheet row · ${Object.keys(fields).length} cells</em></div>
      <div class="ed-pend-v ed-pend-meta">${metadata.map(([label, value]) =>
        `<span><small>${esc(label)}</small><b>${value == null || value === "" ? "—" : esc(value)}</b></span>`).join("")}
        ${a.igdbId ? `<span><small>Source</small><a class="ed-igdb" href="${esc(igdbUrl)}"
          target="_blank" rel="noopener">IGDB ${esc(a.igdbId)} ↗</a></span>` : ""}</div>
      <div class="ed-pend-a"><button class="linkbtn" data-open>Open</button>
        <button class="linkbtn danger" data-unadd>Discard</button></div></div>`;
    };

    const section = (title, hint, html) => !html ? "" :
      `<h4 class="ed-h">${esc(title)}</h4><p class="ce-sub">${hint}</p>${html}`;

    m.body.innerHTML =
      (body.fields.length || body.added.length
        ? `<p class="ce-sub">Nothing here has been written to the workbook. Type it into the
             spreadsheet when you’re next in it — each edit retires itself on the poll after
             the sheet agrees, so this list empties on its own.</p>`
        : `<p class="ce-sub">Nothing staged. Everything on the site matches the spreadsheet.</p>`)
      + section("Conflicts", "The spreadsheet changed under these after you edited them here, so the sheet is winning. Keep yours to re-apply it over the new value.", conflicts.map(fieldRow).join(""))
      + section("Edits", "Staged cell changes, newest first.", plain.map(fieldRow).join(""))
      + section("Orphans", "The row these belonged to is no longer in the sheet — renamed, re-platformed or deleted.", orphans.map(fieldRow).join(""))
      + section("Added games", "Rows that exist only here. They step aside automatically once the same game turns up in the sheet.", body.added.filter((a) => !a.retiredAt).map(addedRow).join(""));

    m.body.querySelectorAll(".ed-pend[data-col]").forEach((el) => {
      const { sheet, key, col } = el.dataset;
      const drop = el.querySelector("[data-drop]");
      if (drop) drop.onclick = async () => { drop.disabled = true; await editDrop(sheet, key, col); render(); };
      const keep = el.querySelector("[data-keep]");
      if (keep) keep.onclick = async () => {
        // Re-stage the same value. The server reads the sheet's CURRENT value as the
        // new base, so the conflict is resolved by accepting it as the starting point.
        const rows = ((DATA.sheets[sheet] || {}).rows) || [];
        const row = rows.find((r) => r._k === key);
        const f = body.fields.find((x) => x.matchKey === key && x.column === col && x.sheet === sheet);
        if (!row || !f) return;
        keep.disabled = true;
        await editPost(row, col, f.value, sheet);
        render();
      };
    });
    m.body.querySelectorAll(".ed-pend[data-row]").forEach((el) => {
      const rowId = el.dataset.row;
      el.querySelector("[data-unadd]").onclick = async () => {
        if (!confirm("Discard this staged game?")) return;
        await editsDiscardAdded(rowId);
        render();
      };
      el.querySelector("[data-open]").onclick = () => {
        const pending = body.added.find((a) => a.rowId === rowId);
        if (!pending) return;
        const rows = (((DATA.sheets[pending.sheet] || {}).rows) || []);
        const row = rows.find((r) => r._rowId === rowId)
          || rows.find((r) => pending.matchKey && r._k === pending.matchKey)
          || { ...pending.fields, _rowId: rowId, _added: true, _k: pending.matchKey,
               _igdbId: pending.igdbId };
        m.close();
        if (typeof openDrawer === "function") {
          openDrawer(row, pending.sheet || "games", false,
            { label: "Pending edits", open: openPendingEdits });
        }
      };
    });
  };
  render();
}
