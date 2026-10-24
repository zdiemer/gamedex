"use strict";

// Trusted renderer HTML only: source components escape all data before composition.
// Keep the existing hltb classes so every source retains its theme and layout.
function sourcePanelHtml(headingHtml, bodyHtml) {
  return `<div class="hltb"><div class="hltb-head">${headingHtml}</div>${bodyHtml}</div>`;
}
