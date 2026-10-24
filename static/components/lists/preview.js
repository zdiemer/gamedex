"use strict";

// UI components for preview.js. Feature state and orchestration remain in that module.

// Cross-fade a game's screenshots over its cover — the fallback preview for the ~thousands
// of games IGDB has stills for but no trailer. Same .previewing/.playing contract as the
// trailer (the cover fades out under it, the tour's fadeOutPreview fades it back), so the
// tour and hover machinery drive it unchanged. No YouTube, so it can't be bot-walled.
function startShotPreview(card, shots) {
  stopPreview();
  previewCard = card;
  const layer = document.createElement("div");
  layer.className = "card-shots";
  card.appendChild(layer);
  card.classList.add("previewing");
  let cur = null;
  const show = (idx, first) => {
    const img = document.createElement("img");
    img.alt = ""; img.style.opacity = "0";
    img.onload = () => {
      if (previewCard !== card) return;
      void img.offsetWidth;                  // commit opacity:0 before transitioning in
      img.style.opacity = "1";
      if (first) card.classList.add("playing");   // reveal only once the first shot is ready — no blank flash
    };
    img.onerror = () => { if (first && previewCard === card) stopPreview(); };
    img.src = IMG(shots[idx], "screenshot_med");
    layer.appendChild(img);
    const old = cur; cur = img;
    if (old) setTimeout(() => old.remove(), 650);   // after its cross-fade partner has faded up
  };
  show(0, true);
  if (shots.length > 1) {
    let i = 0;
    previewShotTimer = setInterval(() => {
      if (previewCard !== card) return;
      i = (i + 1) % shots.length;
      show(i, false);
    }, SHOT_PREVIEW_MS);
  }
}

function startTrailerPreview(card, vid) {
  stopPreview();
  previewCard = card;
  const frame = document.createElement("iframe");
  frame.className = "card-preview";
  // MINIMAL params, and this matters more than it looks. `start`, `loop` and `playlist`
  // each make YouTube draw its full chrome — title bar, channel avatar, watermark, and
  // the big centred pause bezel — EVEN WITH controls=0, and it sits over the video for
  // ~2.5s before auto-hiding. A cross-origin iframe can't be styled and the bezel is
  // centred, so no crop can hide it. Measured: with any of those params the bezel shows;
  // with none of them the player is completely clean. So we ask for none of them and do
  // the seeking and the looping ourselves over the IFrame API (see below).
  frame.src = ytSrc(vid, {
    autoplay: "1", mute: "1", controls: "0", disablekb: "1", iv_load_policy: "3", fs: "0",
  });
  frame.allow = "autoplay; encrypted-media";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  card.appendChild(frame);
  card.classList.add("previewing");

  // Seek to a random 5-10s slice and loop it, over the IFrame API rather than via `start=`
  // and `loop=` in the URL — those make YouTube draw its FULL chrome (title bar, channel
  // avatar, watermark) on top of everything else, whereas API commands only ever cost the
  // centred play/pause overlay.
  //
  // That overlay we could not get rid of, and it wasn't for want of trying: controls=0
  // does not reliably suppress it, and it survives every player size (182px to 960px),
  // every aspect, seek and no-seek alike, with and without the jsapi handshake. It can't
  // be styled (cross-origin) or cropped away (it is centred), and it can't be waited out
  // behind the box art because Chrome occlusion-throttles a covered cross-origin iframe,
  // so its auto-hide timer never runs. It is simply YouTube's embed, and since it shows up
  // either way, we may as well show the good part of the trailer.
  let duration = 0, clip = null;
  previewWatch = ytWatch(frame,
    () => { if (previewCard === card) stopPreview(); },
    () => {
      ytNoCaptions(frame);         // kill them before .playing fades the trailer up
      setTimeout(() => { if (previewCard === card) card.classList.add("playing"); }, 150);
    },
    (info) => {
      if (previewCard !== card) return;
      if (info.duration) duration = info.duration;
      if (!clip && duration) {
        clip = previewClip(vid, duration);
        ytCmd(frame, "seekTo", [clip.start, true]);
        previewLoop = setInterval(() => {
          if (previewCard === card) ytCmd(frame, "seekTo", [clip.start, true]);
        }, clip.len * 1000);
      }
    });
}

// Enrichment arrived: update covers/badges IN PLACE. A full re-render would
// recreate every <img> and make the whole grid flicker on each poll.
function patchEnrichedCells() {
  document.querySelectorAll("#grid .card[data-k]").forEach((card) => {
    const row = CARD_ROW.get(card);
    if (!row) return;
    const cur = card.querySelector(".card-cover");
    const cs = coverSrc(ENRICH[card.dataset.k], "cover_big");
    // Swap the cover when it's a placeholder OR when the resolved cover CHANGED — the
    // latter is how a hand-uploaded box art (uploadCover, set by loadUploads a moment after
    // the IGDB cover was already painted) actually reaches the card; without it the manual
    // art only ever showed on a full re-render and vanished on the next patch.
    if (cs && cur && (cur.tagName !== "IMG" || cur.getAttribute("src") !== cs)) {
      const img = document.createElement("img");
      // Must re-apply .pixel here too: on first paint the enrichment hasn't
      // arrived, so every cover starts as a placeholder and is swapped in HERE.
      img.className = "card-cover" + (coverIsPixelArt(ENRICH[card.dataset.k], cs) ? " pixel" : "");
      img.loading = "lazy"; img.decoding = "async"; img.alt = ""; img.src = cs;
      cur.replaceWith(img);
    } else if (!cs && cur && cur.classList.contains("skel") &&
               (ENRICH_COMPLETE || NO_MATCH.has(card.dataset.k) || (card.dataset.k in ENRICH))) {
      cur.classList.remove("skel");                    // resolved, just no cover
      cur.innerHTML = icon("i-library", 26);
    }
    const body = card.querySelector(".card-body");
    if (body) body.innerHTML = cardBodyHtml(row);      // text only — safe to redraw
  });
  document.querySelectorAll("#tbody tr[data-k]").forEach((tr) => {
    const cs = coverSrc(ENRICH[tr.dataset.k], "cover_small");
    const cell = tr.querySelector("td.cover");
    if (cs && cell && !cell.querySelector("img")) {
      cell.innerHTML = `<img class="cover-thumb" loading="lazy" src="${cs}" alt="">`;
    }
  });
}

// Grid has no clickable headers — a Sort dropdown + direction toggle stand in.
function populateGridSort() {
  const sel = $("#gridsort");
  // One curated menu per tab (SORT_MENUS, data.js). A tab without one — there
  // isn't such a listing tab today — falls back to its sortable columns.
  const menu = SORT_MENUS[activeTab];
  const cols = menu ? menu.map(sortMeta).filter(Boolean) : columns().filter((c) => c.sort);
  const eff = effectiveSort();
  // No "Default" entry on ANY tab: the default is always a real sort (Release Date, Completion
  // Date, Best match…), so name it and select it. A menu item called "Default" tells you
  // nothing about the order you'd get. effectiveSort() returns the active or the default sort,
  // so eff[0].key is exactly what's showing.
  const cur = eff[0].key;
  // A table-header click can sort by a column the curated menu doesn't carry (Vendor,
  // Genre, Emulated…). Append it rather than showing some other option as selected.
  if (!cols.some((c) => c.key === cur)) {
    const c = sortMeta(cur);
    if (c) cols.push(c);
  }
  sel.innerHTML = cols.map((c) => `<option value="${c.key}">${escapeHtml(sortLabel(c))}</option>`).join("");
  sel.value = cols.some((c) => c.key === cur) ? cur : (cols[0] ? cols[0].key : "");
  $("#gridsortdir").textContent = eff[0].dir === "asc" ? "▲" : "▼";
  $("#gridsortdir").disabled = false;      // Release Date can be flipped like anything else
}

function renderPager(pages) {
  const st = tabState[activeTab];
  createPager({ host: $("#pager"), page: st.page, pages, onChange: (page) => {
    st.page = page;
    renderTable(currentFiltered);
    $("#tablewrap").scrollTop = 0; $("#gridwrap").scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "smooth" });
    nav();
  } });
}
