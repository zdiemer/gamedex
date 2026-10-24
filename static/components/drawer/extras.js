"use strict";

// UI components for extras.js. Feature state and orchestration remain in that module.

function renderViews() {
  const bar = $("#views");
  if (!bar) return;
  // A saved view belongs to the tab it was captured on, so each listing page only
  // shows its own — but keep the ORIGINAL index so the chip/✕ still map into the
  // full stored list.
  const mine = loadViews().map((v, i) => ({ v, i })).filter(({ v }) => viewTab(v) === activeTab);
  const st = tabState[activeTab];
  const filtered = st && (st.search || Object.keys(st.facets || {}).length);
  bar.hidden = SPECIAL_TABS.includes(activeTab) || (!mine.length && !filtered);
  if (bar.hidden) return;

  bar.innerHTML =
    mine.map(({ v, i }) => `<button class="view-chip" data-vi="${i}" title="${escapeHtml(v.desc || "")}">
        ${escapeHtml(v.name)}<span class="view-x" data-vx="${i}" title="Forget this view">✕</span>
      </button>`).join("") +
    (filtered ? `<button class="view-save" id="viewSave">＋ Save this view</button>` : "");

  bar.querySelectorAll("[data-vi]").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.vx !== undefined) return;    // the ✕ has its own job
      const v = loadViews()[+el.dataset.vi];
      if (!v) return;
      history.pushState({}, "", v.query || location.pathname);
      restoreFromURL();
    };
  });
  bar.querySelectorAll("[data-vx]").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const views2 = loadViews();
      views2.splice(+el.dataset.vx, 1);
      storeViews(views2);
      renderViews();
    };
  });
  const save = $("#viewSave");
  if (save) {
    save.onclick = async () => {
      const suggested = describeView().slice(0, 40) || "My view";
      const name = await uiPrompt({ title: "Name this view", value: suggested, placeholder: "My view" });
      if (!name) return;
      const views2 = loadViews();
      views2.unshift({ name: name.slice(0, 40), tab: activeTab, query: location.search || "", desc: describeView() });
      storeViews(views2);
      renderViews();
    };
  }
}

function coverAccent(src, cb) {
  if (!src) return;
  if (ACCENT_CACHE.has(src)) return cb(ACCENT_CACHE.get(src));
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      const W = 24, H = 32;                       // tiny: we want an average, not detail
      c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const max = Math.max(R, G, B), min = Math.min(R, G, B);
        // Skip the near-black and near-white pixels — box art is mostly letterbox
        // and logo, and averaging those gives you grey every time.
        if (max < 40 || min > 225) continue;
        const sat = max === 0 ? 0 : (max - min) / max;
        const w = 0.25 + sat;                     // let the colourful pixels win
        r += R * w; g += G * w; b += B * w; n += w;
      }
      if (!n) return;
      const accent = boostAccent(r / n, g / n, b / n);
      ACCENT_CACHE.set(src, accent);
      cb(accent);
    } catch (_) {
      /* tainted canvas (non-CORS host) — keep the default accent */
    }
  };
  img.src = src;
}
