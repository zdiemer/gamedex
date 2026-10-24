"use strict";

// SPA adapter. Fixture data and duplicate sample IDs stay inside the protected
// workbench frame; the application owns navigation, history and theme.
const COMPONENT_LIBRARY = { id: "search", frame: null, observer: null };
const componentLibraryId = value => typeof value === "string" && /^[\w-]{1,120}$/.test(value) ? value : "search";
TAB_RESET.components = () => { COMPONENT_LIBRARY.id = "search"; };
function syncComponentLibrary() {
  COMPONENT_LIBRARY.frame?.contentWindow?.postMessage({
    type: "component-library-view", id: COMPONENT_LIBRARY.id,
    theme: document.documentElement.dataset.theme || "dark",
  }, location.origin);
}
function disposeComponentLibrary() {
  COMPONENT_LIBRARY.observer?.disconnect();
  COMPONENT_LIBRARY.observer = null;
  COMPONENT_LIBRARY.frame?.remove();
  COMPONENT_LIBRARY.frame = null;
}

window.addEventListener("message", event => {
  if (!IS_ADMIN || activeTab !== "components" || event.origin !== location.origin
      || event.source !== COMPONENT_LIBRARY.frame?.contentWindow) return;
  const message = event.data;
  if (message?.type === "component-library-selection") {
    COMPONENT_LIBRARY.id = componentLibraryId(message.id);
    syncURL(false);
  } else if (message?.type === "component-library-theme" && ["light", "dark"].includes(message.theme)) {
    localStorage.setItem(THEME_KEY, message.theme);
    applyTheme(message.theme);
  }
});
