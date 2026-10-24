"use strict";

// Presentation accepts trusted renderer HTML. Escape external data in the adapter.
// A null configuration suppresses a source with no content; a missing heading is valid.
function panelHtml(config) {
  if (!config) return "";
  const { headingHtml = "", bodyHtml = "", className = "", data = {} } = config;
  const attrs = Object.entries(data).map(([key, value]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new TypeError(`Invalid panel data key: ${key}`);
    return ` data-${key}="${escapeHtml(String(value))}"`;
  }).join("");
  return `<div class="hltb${className ? " " + escapeHtml(className) : ""}"${attrs}>${headingHtml ? `<div class="hltb-head">${headingHtml}</div>` : ""}${bodyHtml}</div>`;
}
function sourcePanelHtml(source, data) {
  if (!Object.hasOwn(SOURCE_PANEL_DATA, source)) throw new TypeError(`Unknown panel source: ${source}`);
  return panelHtml(SOURCE_PANEL_DATA[source](data));
}

// Labels and values are trusted renderer fragments; classes are always escaped.
function panelRowHtml({ labelHtml, valueHtml, className = "", valueClass = null }) {
  return `<div class="hltb-row${className ? " " + escapeHtml(className) : ""}"><span>${labelHtml}</span><b${valueClass !== null ? ` class="${escapeHtml(valueClass)}"` : ""}>${valueHtml}</b></div>`;
}
