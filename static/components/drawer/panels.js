"use strict";

// UI components for panels.js. Feature state and orchestration remain in that module.

function renderIgdbSection(key, el, status, detail) {
  // The relationship map is about YOUR collection, not IGDB's copy of the game,
  // so it's painted into its own host rather than the enrichment block.
  const relHost = $("#relations");
  if (relHost && status === "matched" && detail) {
    relHost.innerHTML = relationsHtml(detail);
    wireRelations(relHost);
    // IGDB wins, the sheet Collection is the fallback: once IGDB confirms a grouping
    // (episodes, a bundle's games, DLC…), fold away the in-house collection section so
    // the same set isn't shown twice. It rendered synchronously; IGDB detail is async.
    if (typeof relationsHaveGrouping === "function" && relationsHaveGrouping(detail)) {
      const colSec = document.querySelector("#drawerBody .col-section");
      if (colSec) colSec.hidden = true;
    }
  }
  let content;
  if (status === "matched" && detail) { content = detailHtml(detail); fillHero(detail); }
  else if (status === "no_match") content = `<div class="igdb-loading muted">No IGDB match for this title.</div>`;
  else {
    // Loading / pending / error. The hero already carries the cover and title,
    // so this is only the prose area — shimmer lines, never a bare "Loading".
    const msg = status === "pending-final" ? "Metadata still resolving. Reopen shortly."
      : status === "error" ? "Couldn’t load extra details." : "";
    content = msg
      ? `<div class="igdb-loading muted">${msg}</div>`
      : `<div class="skel skel-line" style="height:18px;width:40%"></div>
         <div class="skel skel-line"></div><div class="skel skel-line"></div>
         <div class="skel skel-line short"></div>`;
  }
  // The Steam store panel (Deck rating, ProtonDB) and PCGamingWiki are the PC
  // copy's story — the enricher joins them on the Steam appid it finds for ANY
  // copy of the game, so gate them off the row's platform family the way the
  // mine surfaces do. An unresolvable key keeps them (mineOnHomePlatform's rule).
  const pcCopy = typeof mineOnHomePlatform !== "function" || mineOnHomePlatform(key, "steam");
  el.innerHTML = content + sourcePanelHtml("hltb", HLTBC[key]) + sourcePanelHtml("speedrun", key) + sourcePanelHtml("metacritic", key)
    + sourcePanelHtml("coop", key) + (pcCopy ? sourcePanelHtml("steamx", key) : "") + sourcePanelHtml("arcade", key) + sourcePanelHtml("vndb", key) + sourcePanelHtml("thumby", key) + sourcePanelHtml("guides", key)
    + soundtrackHtml(key) + (pcCopy ? sourcePanelHtml("pcgw", key) : "") + sourcePanelHtml("sales", key) + sourcePanelHtml("physical", key) + sourcePanelHtml("wikidata", key)
    + sourcePanelHtml("gameye", key) + (IS_ADMIN ? mapControlHtml(key) : "");   // "Fix mapping" is a write — admin only

  wireSoundtrack(key, el);   // collapse/expand the tracklist, drive the docked player

  // The Shelf's manual reader, reached from the drawer too — you shouldn't have to go and
  // find the box on the shelf to read the booklet that came in it.
  const readBtn = el.querySelector("[data-read-manual]");
  if (readBtn) {
    readBtn.onclick = (ev) => {
      ev.preventDefault();
      openManual({ mk: key, t: (drawerRow && (drawerRow.title || drawerRow.game)) || "" });
    };
  }

  el.querySelectorAll(".map-src").forEach((rowEl) => {
    const src = rowEl.dataset.src;
    const go = rowEl.querySelector("[data-map-go]");
    const input = rowEl.querySelector("[data-map-input]");
    const reset = rowEl.querySelector("[data-map-reset]");
    const remove = rowEl.querySelector("[data-map-remove]");
    const submit = async () => {
      const url = input.value.trim();
      if (!url) return;
      go.disabled = true; go.textContent = "…"; input.classList.remove("err");
      const ok = await submitOverride(key, url, src);
      go.disabled = false; go.textContent = "Map";
      if (ok) loadDetail(key, el); else input.classList.add("err");
    };
    go.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
    reset.onclick = async () => { await submitOverride(key, "", src); loadDetail(key, el); };
    remove.onclick = async () => {
      await submitOverride(key, "", src, true);   // pin as no match
      input.value = "";
      loadDetail(key, el);
    };
  });

  wireCarousel(el, detail ? mediaOf(detail) : []);
  el.querySelectorAll("[data-simk]").forEach((btn) => {
    btn.onclick = () => {
      const row = ((DATA.sheets.games || {}).rows || []).find((r) => String(r._k) === btn.dataset.simk);
      if (row) openDrawerFrom(row, "games");        // navigation: keep a way back
    };
  });
}
