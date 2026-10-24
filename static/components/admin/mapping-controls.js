"use strict";

function mapControlHtml(key) {
  // Current mapping per source, so the boxes show what a game is already matched to.
  const d = DETAIL[key] || {};
  const primary = d.source ? String(d.source).toLowerCase() : (d.igdbId ? "igdb" : null);
  const cur = {
    igdb: primary === "igdb" ? d.url || "" : "",
    steam: primary === "steam" ? d.url || "" : "",
    ign: primary === "ign" ? d.url || "" : "",
    launchbox: primary === "launchbox" ? d.url || "" : "",
    keitai: primary === "keitai wiki" ? d.url || "" : "",
    hltb: (HLTBC[key] || {}).url || "",
    metacritic: (MCC[key] || {}).url || "",
    gameye: (GEC[key] || {}).url || "",
    arcadedb: (ADBC[key] || {}).url || "",
    vndb: (VNC[key] || {}).url || "",
    vgchartz: (VGC[key] || {}).url || "",
    steamx: (SXC[key] || {}).url || "",
    speedrun: (SRC[key] || {}).url || "",
    guides: (GDC[key] || {}).url || "",
    khinsider: (KHC[key] || {}).url || "",
  };
  // IGDB / Steam / IGN all fill the same "primary metadata" slot.
  const rows = [
    { id: "igdb", label: "Metadata · IGDB", ph: "IGDB game URL" },
    { id: "steam", label: "Metadata · Steam", ph: "Steam store URL (…/app/<id>/)" },
    { id: "ign", label: "Metadata · IGN", ph: "IGN game URL" },
    { id: "launchbox", label: "Metadata · LaunchBox", ph: "LaunchBox game URL" },
    // The only source that knows the Japanese feature phones, so it's the one you reach
    // for when a DoJa game's title on the wiki isn't the title in the sheet.
    { id: "keitai", label: "Metadata · Keitai Wiki", ph: "keitaiwiki.com/wiki/<page>" },
  ];
  // Every configured source gets a box. The auto-enrichment gates (VNDB only asks about
  // sheet-genre "Visual Novel"/"Adventure", Arcade Database only about MAME romsets, and
  // so on) decide who we ASK — they must not decide who you can MAP. Gating the fix-it
  // panel behind the same heuristic that made the mistake is what hid VNDB on Tōshin Toshi
  // II, a VN the sheet happens to file as a Dungeon Crawler. The panel is collapsed behind
  // "Fix mapping" anyway, so the cost of an extra row is nothing next to an unfixable game.
  if (ENRICH_SOURCES.includes("hltb")) rows.push({ id: "hltb", label: "HowLongToBeat", ph: "HLTB game URL" });
  if (ENRICH_SOURCES.includes("metacritic")) rows.push({ id: "metacritic", label: "Metacritic", ph: "Metacritic game URL" });
  if (ENRICH_SOURCES.includes("gameye")) rows.push({ id: "gameye", label: "GameEye value", ph: "GameEye encyclopedia URL" });
  if (ENRICH_SOURCES.includes("arcadedb")) rows.push({ id: "arcadedb", label: "Arcade Database", ph: "adb.arcadeitalia.net/?mame=<romset>" });
  if (ENRICH_SOURCES.includes("vndb")) rows.push({ id: "vndb", label: "VNDB", ph: "vndb.org/v<id>" });
  if (ENRICH_SOURCES.includes("vgchartz")) rows.push({ id: "vgchartz", label: "VGChartz sales", ph: "vgchartz.com/games/game.php?id=<id>" });
  // Steam extras are keyed on the appid, so mapping means pointing at the store page.
  if (ENRICH_SOURCES.includes("steamx")) rows.push({ id: "steamx", label: "Steam Deck / ProtonDB", ph: "store.steampowered.com/app/<appid>/" });
  if (ENRICH_SOURCES.includes("speedrun")) rows.push({ id: "speedrun", label: "speedrun.com", ph: "speedrun.com/<game>" });
  if (ENRICH_SOURCES.includes("cooptimus")) rows.push({ id: "cooptimus", label: "Co-Optimus", ph: "co-optimus.com/game/<id>/..." });
  if (ENRICH_SOURCES.includes("guides")) rows.push({ id: "guides", label: "StrategyWiki guide", ph: "strategywiki.org/wiki/<Page>" });
  if (ENRICH_SOURCES.includes("khinsider")) rows.push({ id: "khinsider", label: "KHInsider soundtrack", ph: "downloads.khinsider.com/game-soundtracks/album/<slug>" });
  // These two join on an id rather than a title (the Steam appid, the IGDB slug), so they
  // can't strictly be MIS-matched — but the id itself can be missing or point at the wrong
  // entry, so the escape hatch still earns its place.
  if (ENRICH_SOURCES.includes("pcgw")) rows.push({ id: "pcgw", label: "PCGamingWiki", ph: "pcgamingwiki.com/wiki/<Page>" });
  if (ENRICH_SOURCES.includes("wikidata")) rows.push({ id: "wikidata", label: "Wikidata", ph: "igdb.com/games/<slug>" });
  return `<details class="map-menu"><summary>${icon("i-edit", 13)} Fix mapping</summary>` +
    rows.map((s) => `<div class="map-src" data-src="${s.id}"><label>${escapeHtml(s.label)}</label>
      <div class="map-row"><input type="url" placeholder="${s.ph}" value="${escapeHtml(cur[s.id] || "")}" data-map-input>
      <button class="btn" data-map-go>Map</button>
      <button class="linkbtn" data-map-reset title="Re-run auto-matching">Auto</button>
      <button class="linkbtn danger" data-map-remove title="Pin as no match. Auto-matching won't re-fill it">Remove</button>
      </div></div>`).join("") +
    `</details>`;
}
