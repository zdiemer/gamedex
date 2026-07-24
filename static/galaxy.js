"use strict";

/* Collection Galaxy — the whole library as a force-directed constellation map.

   Every other Discover tab answers a QUESTION about the collection (what to play,
   what to buy, how it breaks down). This one just lets you FLY through it: each
   game is a star, and two stars are linked when they share the rare things that
   make them kin — a franchise, a studio, a distinctive keyword or theme. Clusters
   form on their own: the Zelda cluster, the From Software cluster, the visual-novel
   nebula. Pan, zoom, hover to light up a game's neighbourhood, click to open it.

   Nothing here is fetched or recomputed from scratch. The nodes and the edge
   weights come straight from similar.js's `simIndex()` — the same IDF-weighted
   feature overlap the drawer's "similar games" row already trusts — so a link on
   the map means exactly what a similar-games hit means. simTokensOf() gives each
   game its namespaced feature tokens (f: franchise, d: developer, k: keyword,
   t: theme, g: genre, …), already folded through the canon* spellings so the
   sheet's "Nintendo" and IGDB's "Nintendo EPD" agree before anything compares.

   Loaded after similar.js (needs simIndex/simTokensOf), data.js (canon*),
   relations.js (cachedGameId), enrich.js (coverSrc/ENRICH), drawer.js (openDrawer).

   Where the drawer's similarByFeatures() asks "who is like THIS one", the galaxy
   asks it for every game at once and keeps each star's few strongest links, so the
   graph stays sparse enough to read and to simulate. A star with no strong link is
   a lone game, not a bug — those are hidden by default and counted honestly. */

// ---- knobs ---------------------------------------------------------------
const GX_TOP_EDGES = 5;        // strongest links kept PER star (incoming can add more)
const GX_EDGE_MIN = 5.0;       // below this a shared-feature score is noise, not a link (mirrors SIM_MIN_SCORE)
const GX_STRONG = 5.0;         // …unless one shared feature alone is this informative (a franchise)
const GX_MIN_SHARED = 2;       // need two shared features, unless one is GX_STRONG on its own
const GX_NEIGHBOR_DF_CAP = 200;// a token on more than this many games is too broad to seat a link
                               // (a genre, a mega-publisher) — it still adds weight to a link the
                               // rare tokens already made, it just can't create one. Bounds the crawl.
const GX_MAX_NODES = 3000;     // simulate at most this many stars; keep the best-connected, count the rest
const GX_LEGEND_MAX = 11;      // distinct colours in the legend; everything past the top-N is "Other"

// Deep-space palette — vivid on the near-black canvas, colourblind-spread, theme-independent
// on purpose (a galaxy is dark in light mode too). Index GX_LEGEND_MAX is the grey "Other".
const GX_PALETTE = [
  "#5ea9ff", "#ff8a5c", "#67d98b", "#c98bff", "#ffd166",
  "#4dd6d6", "#ff6b9d", "#9ad14b", "#ffa64d", "#8f9bff",
  "#e15c8a", "#7d8aa3",
];

// Force-sim constants. Tuned for a few thousand stars settling in ~450 cooling ticks.
// Gravity is deliberately gentle: too much and 3,000 stars crush into a pin-dot while a
// handful of weakly-linked ones stay stranded at their start radius, and fit-to-view then
// zooms out to a speck. Strong-but-local repulsion inflates the core into a readable disc.
const GX_REST = 55;            // spring rest length for a unit-weight edge
const GX_SPRING = 0.03;        // spring stiffness (stiff enough to reel a stray in while it's still warm)
const GX_REPULSE = 3200;       // repulsion strength between nearby stars
const GX_REPULSE_DIST = 190;   // …only felt within this world radius (grid-bucketed, keeps it O(n))
const GX_GRAVITY = 0.007;      // pull toward the centre so the graph can't drift or fly apart
const GX_DECAY = 0.88;         // velocity damping per tick
const GX_ALPHA_MIN = 0.01;     // below this the layout is settled — stop the RAF, keep it live for drags
const GX_COOL = 0.99;          // per-tick cooling — slower than usual so the core has time to inflate
const GX_COVER_ZOOM = 1.8;     // show cover thumbnails once zoomed in past this
const GX_R_MIN = 2.6, GX_R_MAX = 6.2;  // star radius by your rating

const galaxyState = { scope: "owned", colorBy: "franchise", showSolo: false, focus: null };

// ---- graph build ---------------------------------------------------------
let _gxGraph = { key: "", g: null };

function gxScopeOk(row, scope) {
  if (scope === "all") return true;
  if (scope === "completed") return !!row.completed;
  return !!row.owned;   // "owned" — the My Games set (backlog included)
}

// The category token that names a star's cluster under the current colour axis.
function gxGroupLabel(cand, colorBy) {
  if (colorBy === "decade") {
    const y = cand.year;
    return y ? (Math.floor(y / 10) * 10) + "s" : "";
  }
  const pref = colorBy === "developer" ? "d:" : colorBy === "genre" ? "g:" : "f:";
  // Strongest token of that category wins (there's usually just one); label carries the spelling.
  let best = "", bestW = -1;
  for (const [k, t] of cand.tokens) {
    if (k.startsWith(pref) && t.w > bestW) { best = t.label; bestW = t.w; }
  }
  return best;
}

// Build {nodes, edges, adj, legend, omitted, capped}. Memoised against the rows
// array identity, the enrichment epoch and the scope/colour/solo knobs — the same
// discipline simIndex() uses, so a sheet refresh or the light map landing rebuilds
// it and a background repaint does not.
function galaxyGraph() {
  const scope = galaxyState.scope, colorBy = galaxyState.colorBy, showSolo = galaxyState.showSolo;
  const rows = ((DATA.sheets.games || {}).rows) || [];
  const key = rows.length + "|" + _enrichEpoch + "|" + scope + "|" + colorBy + "|" + showSolo;
  if (_gxGraph.key === key && _gxGraph.g) return _gxGraph.g;

  const { idf, cands, postings } = simIndex();
  const N = cands.length;
  const inScope = new Array(N);
  for (let i = 0; i < N; i++) inScope[i] = gxScopeOk(cands[i].row, scope);

  const isCompany = (k) => k.startsWith("d:") || k.startsWith("pub:");
  const edgeW = new Map();     // "i|j" (i<j) -> weight

  for (let i = 0; i < N; i++) {
    if (!inScope[i]) continue;
    const hits = new Map();    // j -> {score, shared, kin, max}
    for (const [k, qt] of cands[i].tokens) {
      const list = postings.get(k);
      if (!list || list.length > GX_NEIGHBOR_DF_CAP) continue;   // too broad to seat a link
      const contrib = qt.w * (idf.get(k) || 0);
      const company = isCompany(k);
      for (const j of list) {
        if (j === i || !inScope[j]) continue;
        let h = hits.get(j);
        if (!h) hits.set(j, (h = { score: 0, shared: 0, kin: false, max: 0 }));
        h.score += contrib; h.shared++;
        if (contrib > h.max) h.max = contrib;
        if (!company) h.kin = true;   // a real overlap, not just a shared studio
      }
    }
    // This star's strongest few links, thresholded exactly like a similar-games hit.
    const kept = [];
    for (const [j, h] of hits) {
      if (!h.kin) continue;
      if (h.score < GX_EDGE_MIN) continue;
      if (h.shared < GX_MIN_SHARED && h.max < GX_STRONG) continue;
      kept.push([j, h.score]);
    }
    kept.sort((a, b) => b[1] - a[1]);
    for (let n = 0; n < kept.length && n < GX_TOP_EDGES; n++) {
      const j = kept[n][0], w = kept[n][1];
      const ek = i < j ? i + "|" + j : j + "|" + i;
      const prev = edgeW.get(ek);
      if (prev === undefined || w > prev) edgeW.set(ek, w);   // undirected: keep the stronger view
    }
  }

  // Stars that ended up with at least one link, plus (optionally) the lone ones.
  const degW = new Map();
  for (const [ek, w] of edgeW) {
    const [a, b] = ek.split("|").map(Number);
    degW.set(a, (degW.get(a) || 0) + w);
    degW.set(b, (degW.get(b) || 0) + w);
  }
  const connected = [...degW.keys()];
  let omitted = 0;
  const chosen = new Set(connected);
  if (showSolo) {
    for (let i = 0; i < N; i++) if (inScope[i] && !chosen.has(i)) chosen.add(i);
  } else {
    for (let i = 0; i < N; i++) if (inScope[i] && !chosen.has(i)) omitted++;
  }

  // Cap: if it's still too big to fly smoothly, keep the best-connected stars and
  // say how many were left on the cutting-room floor — a silent cap reads as "all of it".
  let ciList = [...chosen];
  let capped = 0;
  if (ciList.length > GX_MAX_NODES) {
    ciList.sort((a, b) => (degW.get(b) || 0) - (degW.get(a) || 0));
    capped = ciList.length - GX_MAX_NODES;
    ciList = ciList.slice(0, GX_MAX_NODES);
  }

  // Colour groups: the top few labels under the axis get palette colours, the rest grey.
  const freq = new Map();
  for (const ci of ciList) {
    const g = gxGroupLabel(cands[ci], colorBy);
    if (g) freq.set(g, (freq.get(g) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, GX_LEGEND_MAX);
  const colorOf = new Map();
  top.forEach(([label], idx) => colorOf.set(label, GX_PALETTE[idx]));
  const legend = top.map(([label, n], idx) => ({ label, n, color: GX_PALETTE[idx] }));

  // Nodes, with a deterministic starting position hashed from the game id so the
  // galaxy forms the same way every visit (and so we never touch Math.random).
  const idxOf = new Map();
  const nodes = ciList.map((ci, n) => {
    idxOf.set(ci, n);
    const c = cands[ci];
    const h = gxHash(c.gid);
    const ang = (h % 3600) / 3600 * Math.PI * 2;
    const rad = Math.sqrt(((h >>> 12) % 1000) / 1000) * 210 + 26;
    const rating = Number((c.row && c.row.rating) != null ? c.row.rating : c.e.rating) || 0;
    const label = gxGroupLabel(c, colorBy);
    const deg = degW.get(ci) || 0;
    return {
      ci, gid: c.gid, row: c.row, e: c.e,
      title: c.e.name || (c.row && c.row.title) || "",
      group: label,
      color: colorOf.get(label) || GX_PALETTE[GX_LEGEND_MAX],
      r: GX_R_MIN + (rating || 0.45) * (GX_R_MAX - GX_R_MIN) + Math.min(deg, 60) * 0.012,
      x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, vx: 0, vy: 0,
    };
  });

  // Edges re-indexed against the kept-node array; drop any whose endpoint got capped.
  const edges = [];
  const adj = nodes.map(() => []);
  for (const [ek, w] of edgeW) {
    const [a, b] = ek.split("|").map(Number);
    const na = idxOf.get(a), nb = idxOf.get(b);
    if (na === undefined || nb === undefined) continue;
    const e = { a: na, b: nb, w };
    edges.push(e);
    adj[na].push(nb); adj[nb].push(na);
  }

  const g = { nodes, edges, adj, legend, omitted, capped, scope };
  _gxGraph = { key, g };
  return g;
}

// FNV-1a, for a stable per-star seed.
function gxHash(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ---- the running galaxy (layout + canvas + interaction) ------------------
let gxCtl = null;   // the live controller, so setSpecialMode can tear it down

function galaxyTeardown() {
  if (gxCtl) { gxCtl.stop(); gxCtl = null; }
}

function renderGalaxy() {
  const host = $("#galaxy");
  if (!ENRICH_ENABLED && !(((DATA.sheets.games || {}).rows) || []).length) {
    host.innerHTML = emptyState("No data yet", "Your library hasn't loaded."); return;
  }
  const g = galaxyGraph();

  // Re-entry from a background repaint (enrichment poll) must not blow away a galaxy
  // you're flying through: if the same graph is already mounted, leave it running.
  if (gxCtl && gxCtl.key === _gxGraph.key && host.querySelector("canvas")) { gxCtl.syncToolbar(); return; }
  galaxyTeardown();

  if (!g.nodes.length) {
    host.innerHTML = galaxyToolbar(g) + emptyState(
      "No constellations here",
      galaxyState.scope === "completed"
        ? "None of your completed games share enough to link up yet — try a wider scope or turn on lone stars."
        : "Nothing links up in this scope yet. IGDB metadata sharpens the map as it loads.");
    wireGalaxyToolbar(host, null);
    return;
  }

  host.innerHTML = galaxyToolbar(g) +
    `<div class="gx-stage">
       <canvas class="gx-canvas" id="gxCanvas"></canvas>
       <div class="gx-legend" id="gxLegend">${galaxyLegend(g)}</div>
       <div class="gx-tip" id="gxTip" hidden></div>
       <div class="gx-hint">drag to pan · scroll to zoom · click a star to open it</div>
     </div>`;

  gxCtl = galaxyController(host, g, _gxGraph.key);
  wireGalaxyToolbar(host, gxCtl);
}

function galaxyToolbar(g) {
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
  const s = galaxyState;
  const foot = g ? galaxyFootline(g) : "";
  return `<div class="gx-bar">
    <label class="ctl">Scope
      <select id="gxScope">
        ${opt("owned", s.scope, "My Games")}${opt("completed", s.scope, "Completed")}${opt("all", s.scope, "Everything")}
      </select></label>
    <label class="ctl">Colour by
      <select id="gxColor">
        ${opt("franchise", s.colorBy, "Franchise")}${opt("developer", s.colorBy, "Developer")}${opt("genre", s.colorBy, "Genre")}${opt("decade", s.colorBy, "Decade")}
      </select></label>
    <label class="ctl gx-solo"><input type="checkbox" id="gxSolo"${s.showSolo ? " checked" : ""}/> Lone stars</label>
    <span class="field field-inline gx-search">
      <svg class="ico" width="14" height="14" aria-hidden="true"><use href="#i-search"/></svg>
      <input id="gxSearch" type="search" placeholder="Find a star…" autocomplete="off" spellcheck="false"/>
    </span>
    <button id="gxReheat" class="linkbtn" title="Re-run the layout">Reheat</button>
    <span class="spacer"></span>
    <span class="gx-foot" id="gxFoot">${foot}</span>
  </div>`;
}

function galaxyFootline(g) {
  const bits = [`${g.nodes.length.toLocaleString()} stars`, `${g.edges.length.toLocaleString()} links`];
  if (g.omitted) bits.push(`${g.omitted.toLocaleString()} lone (hidden)`);
  if (g.capped) bits.push(`${g.capped.toLocaleString()} over cap`);
  return bits.join(" · ");
}

function galaxyLegend(g) {
  if (!g.legend.length) return "";
  const items = g.legend.map((l) =>
    `<button class="gx-leg" data-leg="${escapeHtml(l.label)}">
       <i style="background:${l.color}"></i><span>${escapeHtml(l.label)}</span><b>${l.n}</b>
     </button>`).join("");
  return items + `<div class="gx-leg gx-leg-other gx-leg-key"><i></i><span>Other</span></div>`;
}

// One controller closes over the canvas, the sim and every listener, and hands back
// stop()/syncToolbar() so the tab machinery can retire it cleanly.
function galaxyController(host, g, key) {
  const canvas = host.querySelector("#gxCanvas");
  const ctx = canvas.getContext("2d");
  const tip = host.querySelector("#gxTip");
  const legendEl = host.querySelector("#gxLegend");
  const nodes = g.nodes, edges = g.edges, adj = g.adj;

  const cam = { x: 0, y: 0, z: 0.9 };
  let W = 0, H = 0, dpr = 1;
  let alpha = 1, raf = 0, running = false;
  let hover = -1, legendPick = null, query = "";
  const covers = new Map();     // node index -> Image (lazy, only when zoomed in)
  let firstFit = true, touched = false, settledFit = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, rect.width); H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  }

  const s2w = (sx, sy) => ({ x: cam.x + (sx - W / 2) / cam.z, y: cam.y + (sy - H / 2) / cam.z });
  const w2sx = (wx) => W / 2 + (wx - cam.x) * cam.z;
  const w2sy = (wy) => H / 2 + (wy - cam.y) * cam.z;

  // ---- force simulation (grid-bucketed repulsion → O(n) per tick) ----
  function tick() {
    const cell = GX_REPULSE_DIST;
    const grid = new Map();
    const ck = (cx, cy) => cx + "," + cy;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell);
      const k = ck(gx, gy);
      let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i);
    }
    // Repulsion between stars sharing a 3×3 cell neighbourhood.
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell);
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
        const b = grid.get(ck(gx + ax, gy + ay)); if (!b) continue;
        for (const j of b) {
          if (j <= i) continue;
          const m = nodes[j];
          let dx = n.x - m.x, dy = n.y - m.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > cell * cell || d2 === 0) { if (d2 === 0) { dx = 0.5; dy = 0.5; d2 = 0.5; } else continue; }
          const d = Math.sqrt(d2);
          const f = GX_REPULSE / d2;
          const ux = dx / d, uy = dy / d;
          n.vx += ux * f; n.vy += uy * f;
          m.vx -= ux * f; m.vy -= uy * f;
        }
      }
    }
    // Springs along links — stronger links pull tighter and shorter.
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const rest = GX_REST / Math.max(1, Math.log2(1 + e.w));
      const f = GX_SPRING * (d - rest);
      const ux = dx / d, uy = dy / d;
      a.vx += ux * f; a.vy += uy * f;
      b.vx -= ux * f; b.vy -= uy * f;
    }
    // Gravity to the centre + integrate with damping.
    for (const n of nodes) {
      n.vx -= n.x * GX_GRAVITY;
      n.vy -= n.y * GX_GRAVITY;
      n.vx *= GX_DECAY; n.vy *= GX_DECAY;
      n.x += n.vx * alpha; n.y += n.vy * alpha;
    }
    alpha *= GX_COOL;
  }

  function fitView() {
    if (!nodes.length) return;
    // Frame the MASS, not the extremes: one strand flung out on a long link would
    // otherwise blow the bounds up and zoom the whole galaxy to a speck. Centre on
    // the mean and size to the 95th-percentile radius, letting a few strays clip.
    let cx = 0, cy = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; }
    cx /= nodes.length; cy /= nodes.length;
    const rad = nodes.map((n) => Math.hypot(n.x - cx, n.y - cy)).sort((a, b) => a - b);
    const r95 = Math.max(60, rad[Math.floor(rad.length * 0.95)] || 200);
    cam.x = cx; cam.y = cy;
    cam.z = Math.max(0.15, Math.min(W / (r95 * 2 + 140), H / (r95 * 2 + 140), 1.6));
  }

  // ---- draw ----
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Space: a soft radial glow on near-black, same in either theme.
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, "#0d1020"); bg.addColorStop(1, "#05060c");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const active = hover >= 0 ? hover : -1;
    const near = active >= 0 ? new Set(adj[active]) : null;
    const matched = query ? new Set() : null;
    if (query) for (let i = 0; i < nodes.length; i++) if (nodes[i].title.toLowerCase().includes(query)) matched.add(i);

    // Edges: one faint batched pass, then the hovered star's links bright on top.
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(140,160,210,0.07)";
    ctx.globalAlpha = active >= 0 ? 0.5 : 1;
    ctx.beginPath();
    for (const e of edges) {
      if (active >= 0 && e.a !== active && e.b !== active) continue;
      ctx.moveTo(w2sx(nodes[e.a].x), w2sy(nodes[e.a].y));
      ctx.lineTo(w2sx(nodes[e.b].x), w2sy(nodes[e.b].y));
    }
    ctx.stroke();
    if (active >= 0) {
      ctx.strokeStyle = "rgba(200,220,255,0.55)"; ctx.lineWidth = 1.4; ctx.globalAlpha = 1;
      ctx.beginPath();
      for (const e of edges) {
        if (e.a !== active && e.b !== active) continue;
        ctx.moveTo(w2sx(nodes[e.a].x), w2sy(nodes[e.a].y));
        ctx.lineTo(w2sx(nodes[e.b].x), w2sy(nodes[e.b].y));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const showCovers = cam.z >= GX_COVER_ZOOM;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const sx = w2sx(n.x), sy = w2sy(n.y);
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
      const dim =
        (legendPick !== null && n.group !== legendPick) ||
        (matched && !matched.has(i)) ||
        (active >= 0 && i !== active && near && !near.has(i));
      const hot = i === active || (matched && matched.has(i)) || (near && near.has(i));
      const r = n.r * Math.max(0.8, Math.min(cam.z, 2.2)) * (i === active ? 1.5 : 1);

      if (showCovers && !dim) {
        const img = coverFor(i);
        if (img && img.complete && img.naturalWidth) {
          const cr = Math.max(r + 3, 16);
          ctx.save();
          ctx.beginPath(); ctx.arc(sx, sy, cr, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
          const ar = img.naturalWidth / img.naturalHeight;
          let dw = cr * 2, dh = dw / ar; if (dh < cr * 2) { dh = cr * 2; dw = dh * ar; }
          ctx.drawImage(img, sx - dw / 2, sy - dh / 2, dw, dh);
          ctx.restore();
          ctx.lineWidth = hot ? 2 : 1;
          ctx.strokeStyle = hot ? "#eaf1ff" : n.color;
          ctx.beginPath(); ctx.arc(sx, sy, cr, 0, Math.PI * 2); ctx.stroke();
          continue;
        }
      }

      ctx.globalAlpha = dim ? 0.16 : 1;
      if (hot) {
        ctx.shadowColor = n.color; ctx.shadowBlur = 14;
      }
      ctx.fillStyle = i === active ? "#ffffff" : n.color;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Labels for the hovered star and, when zoomed in, the biggest hubs on screen.
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const label = (i, strong) => {
      const n = nodes[i], sx = w2sx(n.x), sy = w2sy(n.y);
      if (sx < 0 || sx > W || sy < 0 || sy > H) return;
      const t = n.title.length > 34 ? n.title.slice(0, 33) + "…" : n.title;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(4,6,12,0.9)";
      ctx.fillStyle = strong ? "#f2f6ff" : "rgba(220,228,245,0.75)";
      ctx.strokeText(t, sx, sy + n.r + 4); ctx.fillText(t, sx, sy + n.r + 4);
    };
    if (cam.z >= 2.4 && active < 0 && !query) {
      for (let i = 0; i < nodes.length; i++) if (adj[i].length >= 6) label(i, false);
    }
    if (active >= 0) label(active, true);
  }

  function coverFor(i) {
    if (covers.has(i)) return covers.get(i);
    const src = coverSrc(nodes[i].e, "cover_small");
    if (!src) { covers.set(i, null); return null; }
    const img = new Image(); img.decoding = "async"; img.src = src;
    img.onload = () => { if (running || alpha < GX_ALPHA_MIN) draw(); };
    covers.set(i, img);
    return img;
  }

  // ---- animation loop ----
  function loop() {
    tick();
    draw();
    if (alpha > GX_ALPHA_MIN) { raf = requestAnimationFrame(loop); }
    else {
      running = false; raf = 0;
      // Settled and untouched → frame the whole galaxy once, so it lands centred.
      if (!touched && !settledFit) { settledFit = true; fitView(); draw(); }
    }
  }
  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }
  function reheat(hard) {
    if (hard) for (const n of nodes) { n.vx = n.vy = 0; }
    alpha = Math.max(alpha, 0.7);
    start();
  }

  // ---- interaction ----
  let dragging = false, panning = false, downX = 0, downY = 0, moved = 0, downNode = -1;
  function nodeAt(sx, sy) {
    let best = -1, bestD = 18 * 18;
    for (let i = 0; i < nodes.length; i++) {
      const dx = w2sx(nodes[i].x) - sx, dy = w2sy(nodes[i].y) - sy;
      const d2 = dx * dx + dy * dy;
      const hit = Math.max(10, nodes[i].r * cam.z + 6); const hr = hit * hit;
      if (d2 < hr && d2 < bestD) { bestD = d2; best = i; }
    }
    return best;
  }
  function localXY(ev) {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }
  function onDown(ev) {
    const [x, y] = localXY(ev);
    dragging = true; panning = false; downX = x; downY = y; lastX = x; lastY = y; moved = 0;
    downNode = nodeAt(x, y);
    canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
  }
  function onMove(ev) {
    const [x, y] = localXY(ev);
    if (dragging) {
      const dx = x - lastX, dy = y - lastY;
      lastX = x; lastY = y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) panning = true;
      if (panning) {
        touched = true;
        cam.x -= dx / cam.z; cam.y -= dy / cam.z;
        if (!running) draw();
      }
      return;
    }
    const h = nodeAt(x, y);
    if (h !== hover) {
      hover = h;
      canvas.style.cursor = h >= 0 ? "pointer" : "grab";
      showTip(h, x, y);
      if (!running) draw();
    } else if (h >= 0) { showTip(h, x, y); }
  }
  let lastX = 0, lastY = 0;
  function onUp(ev) {
    const [x, y] = localXY(ev);
    if (dragging && !panning && downNode >= 0 && downNode === nodeAt(x, y)) {
      const row = nodes[downNode].row;
      if (row) openDrawer(row, "games");
    }
    dragging = false; panning = false; downNode = -1;
  }
  function onLeave() { hover = -1; tip.hidden = true; if (!running) draw(); }
  function onWheel(ev) {
    ev.preventDefault();
    touched = true;
    const [x, y] = localXY(ev);
    const before = s2w(x, y);
    const f = Math.exp(-ev.deltaY * 0.0015);
    cam.z = Math.max(0.15, Math.min(6, cam.z * f));
    const after = s2w(x, y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    if (!running) draw();
  }
  function showTip(i, x, y) {
    if (i < 0) { tip.hidden = true; return; }
    const n = nodes[i];
    const sub = [n.group, n.e && n.e.year ? n.e.year : (n.row && n.row.releaseYear) || ""].filter(Boolean).join(" · ");
    tip.innerHTML = `<b>${escapeHtml(n.title)}</b>${sub ? `<span>${escapeHtml(String(sub))}</span>` : ""}`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(W - tw - 8, Math.max(8, x + 14)) + "px";
    tip.style.top = Math.min(H - th - 8, Math.max(8, y + 14)) + "px";
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const ro = new ResizeObserver(() => resize());
  ro.observe(host.querySelector(".gx-stage"));

  // Legend acts as a cluster spotlight: click a colour to isolate that cluster,
  // again to release it. The "Other" swatch is a key, not a button (gx-leg-key).
  if (legendEl) legendEl.addEventListener("click", (ev) => {
    const b = ev.target.closest(".gx-leg"); if (!b || b.classList.contains("gx-leg-key")) return;
    const label = b.dataset.leg || "";
    legendPick = legendPick === label ? null : label;
    legendEl.querySelectorAll(".gx-leg").forEach((el) =>
      el.classList.toggle("on", legendPick !== null && (el.dataset.leg || "") === legendPick));
    if (!running) draw();
  });

  resize();
  reheat(false);
  const fit = setTimeout(() => { if (firstFit) { firstFit = false; fitView(); if (!running) draw(); } }, 550);

  return {
    key,
    stop() {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(fit);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      running = false;
    },
    reheat: () => reheat(true),
    setQuery(q) {
      query = String(q || "").trim().toLowerCase();
      if (query) {
        // Frame the matches: if any are found, gently fit them into view.
        let m0 = null;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, hits = 0;
        for (const n of nodes) if (n.title.toLowerCase().includes(query)) {
          hits++; m0 = n;
          minx = Math.min(minx, n.x); miny = Math.min(miny, n.y);
          maxx = Math.max(maxx, n.x); maxy = Math.max(maxy, n.y);
        }
        if (hits) {
          cam.x = (minx + maxx) / 2; cam.y = (miny + maxy) / 2;
          if (hits > 1) cam.z = Math.max(0.4, Math.min(W / (maxx - minx + 200), H / (maxy - miny + 200), 2.2));
        }
      }
      if (!running) draw();
    },
    syncToolbar() {},
  };
}

// ---- toolbar wiring ------------------------------------------------------
function wireGalaxyToolbar(host, ctl) {
  const scope = host.querySelector("#gxScope");
  const color = host.querySelector("#gxColor");
  const solo = host.querySelector("#gxSolo");
  const reheat = host.querySelector("#gxReheat");
  const search = host.querySelector("#gxSearch");
  const rebuild = () => { galaxyTeardown(); renderGalaxy(); nav(); };
  if (scope) scope.onchange = (e) => { galaxyState.scope = e.target.value; rebuild(); };
  if (color) color.onchange = (e) => { galaxyState.colorBy = e.target.value; rebuild(); };
  if (solo) solo.onchange = (e) => { galaxyState.showSolo = e.target.checked; rebuild(); };
  if (reheat && ctl) reheat.onclick = () => ctl.reheat();
  if (search && ctl) {
    let t = 0;
    search.oninput = (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => ctl.setQuery(v), 160); };
  }
}

TAB_RESET.galaxy = () => { galaxyState.focus = null; };
