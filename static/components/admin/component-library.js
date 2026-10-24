"use strict";

// UI components for component-library.js. Feature state and orchestration remain in that module.

function renderComponentLibrary() {
  const host = $("#componentLibrary");
  if (!IS_ADMIN) { disposeComponentLibrary(); host.replaceChildren(); return; }
  if (COMPONENT_LIBRARY.frame) { syncComponentLibrary(); return; }
  const frame = document.createElement("iframe");
  frame.title = "Component library";
  frame.className = "component-library-frame";
  const query = new URLSearchParams({ embedded: "1", component: COMPONENT_LIBRARY.id,
    theme: document.documentElement.dataset.theme || "dark" });
  frame.src = `components.html?${query}`;
  COMPONENT_LIBRARY.frame = frame;
  host.replaceChildren(frame);
  frame.addEventListener("load", syncComponentLibrary);
  COMPONENT_LIBRARY.observer = new MutationObserver(syncComponentLibrary);
  COMPONENT_LIBRARY.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
