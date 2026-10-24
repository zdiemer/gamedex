"use strict";

// State, navigation and scrolling belong to the caller. Reuse an existing host
// for listings, or accept a new .pager element for independently paged views.
function createPager({ page, pages, onChange, host = document.createElement("div") }) {
  host.classList.add("pager");
  host.replaceChildren();
  if (pages <= 1) return host;
  let current = page;
  const go = (value) => {
    if (!Number.isFinite(value)) { input.value = String(current); return; }
    const next = Math.min(pages, Math.max(1, Math.trunc(value)));
    input.value = String(next);
    if (next === current) return;
    current = next; // Enter followed by blur must not navigate twice.
    onChange(next);
  };
  const button = (label, target, disabled, title) => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.disabled = disabled;
    if (title) el.title = title;
    el.onclick = () => go(target);
    return el;
  };
  const jump = document.createElement("span");
  jump.className = "page-jump";
  jump.innerHTML = `Page <input type="number" min="1" max="${pages}" value="${page}" aria-label="Page number"> of ${pages.toLocaleString()}`;
  const input = jump.querySelector("input");
  const commit = () => go(parseInt(input.value, 10));
  input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } };
  input.onblur = commit;
  host.append(button("«", 1, page <= 1, "First page"),
    button("‹ Prev", page - 1, page <= 1), jump,
    button("Next ›", page + 1, page >= pages),
    button("»", pages, page >= pages, "Last page"));
  return host;
}
