"use strict";

// Presentation accepts trusted renderer HTML. Escape external data in the adapter.
// A null configuration suppresses a source with no content; a missing heading is valid.
/**
 * @component Render the shared shell for source and feature panels.
 * @param {Object|null} config - Null hides the panel.
 * @param {string} [config.headingHtml=""] - Trusted heading fragment; empty omits the heading.
 * @param {string} [config.bodyHtml=""] - Trusted body fragment.
 * @param {string} [config.className=""] - Additional feature classes.
 * @param {Object<string,*>} [config.data={}] - data-* suffixes and values; keys must match /^[a-z][a-z0-9-]*$/.
 * @returns {string} Panel HTML, or an empty string for null; invalid data keys throw TypeError.
 * @requires escapeHtml; .hltb and .hltb-head styles.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping headingHtml and bodyHtml are trusted renderer output; escape external data before composing them. Classes and data values are escaped.
 * @example
 * panelHtml({ className: "my-panel", data: { "game-key": key }, headingHtml: "Details", bodyHtml: escapeHtml(title) });
 */
function panelHtml(config) {
  if (!config) return "";
  const { headingHtml = "", bodyHtml = "", className = "", data = {} } = config;
  const attrs = Object.entries(data).map(([key, value]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new TypeError(`Invalid panel data key: ${key}`);
    return ` data-${key}="${escapeHtml(String(value))}"`;
  }).join("");
  return `<div class="hltb${className ? " " + escapeHtml(className) : ""}"${attrs}>${headingHtml ? `<div class="hltb-head">${headingHtml}</div>` : ""}${bodyHtml}</div>`;
}
/**
 * @component Adapt source data into the shared panel shell.
 * @param {string} source - Own key of SOURCE_PANEL_DATA; unknown keys throw TypeError.
 * @param {*} data - Input expected by that source adapter, usually a game key; hltb accepts a record.
 * @returns {string} Panel HTML; adapters return null to hide unavailable content.
 * @requires SOURCE_PANEL_DATA from panels/sources.js and panelHtml; each adapter documents its source globals in its implementation.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Adapters must escape external text and URLs before returning trusted heading/body fragments.
 * @example
 * sourcePanelHtml("hltb", { main: 18, mainPlus: 25, hundred: 40 });
 */
function sourcePanelHtml(source, data) {
  if (!Object.hasOwn(SOURCE_PANEL_DATA, source)) throw new TypeError(`Unknown panel source: ${source}`);
  return panelHtml(SOURCE_PANEL_DATA[source](data));
}

// Labels and values are trusted renderer fragments; classes are always escaped.
/**
 * @component Render a label/value row inside a shared panel.
 * @param {Object} options - Required row configuration.
 * @param {string} options.labelHtml - Trusted label fragment.
 * @param {string} options.valueHtml - Trusted value fragment inside a b element.
 * @param {string} [options.className=""] - Extra row classes.
 * @param {string|null} [options.valueClass=null] - Value classes; null omits the class attribute.
 * @returns {string} A .hltb-row element.
 * @requires escapeHtml and .hltb-row styles.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Label and value fragments are inserted as HTML. Class names are escaped.
 * @example
 * panelRowHtml({ labelHtml: "Status", valueHtml: escapeHtml(status), valueClass: "good" });
 */
function panelRowHtml({ labelHtml, valueHtml, className = "", valueClass = null }) {
  return `<div class="hltb-row${className ? " " + escapeHtml(className) : ""}"><span>${labelHtml}</span><b${valueClass !== null ? ` class="${escapeHtml(valueClass)}"` : ""}>${valueHtml}</b></div>`;
}
