"use strict";

// UI components for core.js. Feature state and orchestration remain in that module.

/* Icons. `icon("i-play")` -> inline SVG that inherits currentColor.
   `glyph(v)` renders an icon id if it looks like one, and otherwise passes the
   value straight through — because a custom challenge's icon is an emoji YOU
   chose, and that's data, not chrome. */
const icon = (id, size = 16) =>
  `<svg class="ico" width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;

const glyph = (v, size = 16) =>
  (typeof v === "string" && v.startsWith("i-")) ? icon(v, size) : `<span class="emo">${v || ""}</span>`;

// Returns an HTML string for a cell value given its column type.
function fmtCell(value, type) {
  if (value === undefined || value === null || value === "") return `<span class="muted">—</span>`;
  if (Array.isArray(value)) value = value.join(", ");   // multi-valued cell (e.g. Wishlisted On)
  switch (type) {
    case "rating":
      return `<span class="${ratingClass(value)}">${Math.round(value * 100)}%</span>`;
    case "bool":
      return value ? `<span class="yes">Yes</span>` : `<span class="no">No</span>`;
    case "hours":
      return fmtHours(value);
    case "date":
      return escapeHtml(fmtDate(value));
    case "number":
      return typeof value === "number" ? escapeHtml(value.toLocaleString()) : escapeHtml(String(value));
    case "money":
      return typeof value === "number"
        ? "$" + escapeHtml(value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        : escapeHtml(String(value));
    default:
      return escapeHtml(String(value));
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function copyResultText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Older Safari has the share sheet but no async clipboard API. Keep a final copy
  // path for desktop browsers and installed PWAs that expose neither.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const copied = document.execCommand("copy");
  ta.remove();
  if (!copied) throw new Error("copy failed");
}

// input: the text box (ideally already inside a .ac-wrap); getItems: () => [{t, f}]
// with t the display title and f its acFold — computed once by the caller, not per keystroke.
function acAttach(input, getItems) {
  let wrap = input.closest(".ac-wrap");
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.className = "ac-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }
  const list = document.createElement("div");
  list.className = "ac-list";
  list.hidden = true;
  wrap.appendChild(list);
  let rows = [], active = -1;

  const close = () => { list.hidden = true; active = -1; };
  const paint = () => {
    [...list.children].forEach((el, i) => el.classList.toggle("on", i === active));
  };
  const pick = (i) => {
    if (!rows[i]) return;
    input.value = rows[i].t;
    close();
    input.focus();
  };
  const update = () => {
    const q = acFold(input.value);
    if (q.length < 2) return close();
    const toks = q.split(" ");
    const scored = [];
    for (const it of getItems()) {
      let score;
      if (it.f.startsWith(q)) score = 0;
      else if (it.f.includes(q)) score = 1;
      else if (toks.every((t) => it.f.includes(t))) score = 2;
      else continue;
      scored.push([score, it]);
      if (scored.length > 200) break;              // plenty to sort a top-10 from
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].t.localeCompare(b[1].t));
    rows = scored.slice(0, 10).map((x) => x[1]);
    active = -1;
    if (!rows.length) return close();
    list.innerHTML = "";
    rows.forEach((it, i) => {
      const el = document.createElement("div");
      el.className = "ac-item";
      el.textContent = it.t;
      // mousedown, not click: it fires before the input's blur can close the list.
      el.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(i); });
      list.appendChild(el);
    });
    list.hidden = false;
  };

  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => setTimeout(close, 120));
  // Registered before the caller assigns its own Enter handler, so a consumed
  // Enter (completing the highlighted row) never also submits the guess.
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, -1); paint(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(active); }
    else if (e.key === "Escape") { e.stopImmediatePropagation(); close(); }
  });
}
