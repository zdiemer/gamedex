"use strict";

// State, navigation and scrolling belong to the caller. Reuse an existing host
// for listings, or accept a new .pager element for independently paged views.
/**
 * @component Build pagination controls while the caller owns page state and rerendering.
 * @param {Object} options - Required pagination configuration.
 * @param {number} options.page - Current one-based integer page, within the page range.
 * @param {number} options.pages - Total integer pages; controls are empty when pages <= 1.
 * @param {function(number):void} options.onChange - Update state and rerender the pager for the new page.
 * @param {HTMLElement} [options.host=document.createElement("div")] - Existing or newly created host; its children are replaced.
 * @returns {HTMLElement} The host with .pager; append it if it was newly created.
 * @requires Browser DOM and .pager/.page-jump styles.
 * @events Buttons, Enter, and blur call onChange with a clamped page. An unchanged page does not call it; Enter followed by blur does not double-navigate.
 * @cleanup Handlers belong to the generated children. Reuse the host on rerender or remove it on teardown; no document listeners are installed.
 * @escaping page and pages must be trusted finite integers; they are interpolated into input attributes. Button labels use textContent.
 * @example
 * const draw = page => createPager({ host, page, pages: 12, onChange: draw });
 * draw(1);
 */
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
