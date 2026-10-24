"use strict";

// UI components for jukebox.js. Feature state and orchestration remain in that module.

// ---- the dock ---------------------------------------------------------------
function jbDraw() {
  const host = $("#jukebox");
  if (!host || !JB.on) return;
  const cur = JB.cur;
  const e = cur ? ENRICH[cur.key] : null;
  const trk = cur ? cur.album.tracks[cur.ti] : null;
  const cover = cur
    ? (coverSrc(e, "cover_small") || (cur.album.cover ? cImg(cur.album.cover) : ""))
    : "";
  const composers = (e && e.composers || []).slice(0, 2).join(" · ");
  const playing = JB.audio && !JB.audio.paused;
  const comps = JB.browse ? jbComposers() : [];
  host.innerHTML = `
    ${JB.browse ? `<div class="jb-browse">
      <button class="jb-dial${JB.composer ? "" : " on"}" data-jb-dial="">Everything ·
        ${jbPoolCountAll()} soundtracks</button>
      ${comps.map((c) => `<button class="jb-dial${JB.composer === c.name ? " on" : ""}"
        data-jb-dial="${escapeHtml(c.name)}">${escapeHtml(c.name)} · ${c.total} game${c.total === 1 ? "" : "s"}</button>`).join("")}
      ${comps.length ? "" : `<span class="muted">No composers on file yet.</span>`}
    </div>` : ""}
    <div class="jb-bar">
      <button class="jb-cover" data-jb-open title="Open in library">
        ${cover ? `<img src="${escapeHtml(cover)}" alt="">` : icon("i-music", 22)}
      </button>
      <div class="jb-meta">
        <span data-jb-open class="jb-titles">
          <b>${trk ? escapeHtml(trk.name || "") : "Tuning…"}</b>
          <span class="muted">${cur ? escapeHtml([cur.row.title, cur.row.platform].filter(Boolean).join(" · ")) : ""}</span>
          ${composers ? `<span class="jb-composer">${icon("i-music", 10)} ${escapeHtml(composers)}</span>` : ""}
        </span>
        <div class="jb-scrub">
          <span class="jb-time" id="jbTimeCur">0:00</span>
          <div class="jb-timebar" data-jb-seek><i id="jbTimeFill"></i></div>
          <span class="jb-time" id="jbTimeDur">–:––</span>
        </div>
      </div>
      <div class="jb-ctl">
        <button data-jb-prev title="Previous">${icon("i-skip-back", 16)}</button>
        <button data-jb-play title="Play/pause">${icon(playing ? "i-pause" : "i-play", 18)}</button>
        <button data-jb-next title="Next">${icon("i-skip-fwd", 16)}</button>
        <button data-jb-vol-toggle class="${JB.volOpen || (JB.audio && JB.audio.muted) ? "on" : ""}" title="Volume">
          ${icon(JB.audio && (JB.audio.muted || JB.audio.volume === 0) ? "i-muted" : "i-volume", 15)}</button>
        <button data-jb-dial-toggle class="${JB.composer ? "on" : ""}"
          title="${JB.composer ? `Playing: ${escapeHtml(JB.composer)}` : "By composer"}">${icon("i-filter", 15)}</button>
        <button data-jb-close title="Stop the jukebox">${icon("i-close", 15)}</button>
        ${JB.volOpen ? `<div class="jb-volpop">
          <div class="jb-vtrack" data-jb-vtrack><i id="jbVolFill"
            style="height:${Math.round((JB.audio && !JB.audio.muted ? JB.audio.volume : 0) * 100)}%"></i></div>
          <button data-jb-mute title="Mute">${icon(JB.audio && JB.audio.muted ? "i-muted" : "i-volume", 14)}</button>
        </div>` : ""}
      </div>
    </div>`;
  jbWire(host);
  jbDrawTime();
}
