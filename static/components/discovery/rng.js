"use strict";

// UI components for rng.js. Feature state and orchestration remain in that module.

/* ---- the cards ----------------------------------------------------------
   Three columns, each one an eyebrow saying which slot it is, the REAL grid card
   (so the hover trailer works here exactly as it does in the listings), and the
   two things you'd do next: roll this one again, or go and read about it.

   A pinned column is the same card with the roll taken out of it: the count in the
   eyebrow says "Pinned" instead of a pool it can't reach, the chip row says you're
   playing it, and Re-roll becomes Unpin. */
function rngSlotHtml(slot, pool) {
  const row = rngState.picks[slot.id];
  const pinned = rngIsPinned(slot.id);
  const head = `<div class="rng-head">
      <span class="rng-eye">${icon(slot.icon, 12)} ${escapeHtml(slot.label)}</span>
      ${pinned
        ? `<span class="rng-n pinned" title="Pinned to a game you're playing — this slot doesn't roll">${icon("i-pin", 11)} Pinned</span>`
        : `<span class="rng-n" title="Games in this slot's pool">${pool.length.toLocaleString()}</span>`}
    </div>`;
  const box = (inner, cls = "") =>
    `<div class="rng-slot${cls}" data-slot="${slot.id}" style="--slot: ${slot.tint}">${head}${inner}</div>`;

  if (!row) {
    return box(`<div class="rng-blank">
        <span class="rng-blank-ico">${icon(pool.length ? "i-dice" : "i-alert", 24)}</span>
        <p>${pool.length ? "Roll to fill this slot." : "Nothing in your library fits this slot."}</p>
        <span class="rng-hint">${escapeHtml(slot.hint)}</span>
        ${rngPinMenuHtml(slot.id)}
      </div>`, " rng-off");
  }

  const rec = igdbRecOf(row);
  const card = `<div class="${posterClassName(row)}" data-rngcard="${slot.id}">${
    posterContentHtml(row, cardBodyHtml(row), { enrichment: rec, pending: coverPending(row), eager: true })}</div>`;

  const copy = rngCopyChip(row);
  const time = rngTimeChip(row);

  /* Pin, on the card in front of you, but only when the sheet already calls this one
     Playing — the button can't make that true, and a pin that didn't mean "in progress"
     would be a second, quieter status column nobody maintains. Everything else you might
     want to pin is in the menu below, which lists the rest of the Playing games. */
  const acts = pinned
    ? `<button class="rng-open" data-unpin="${slot.id}">${icon("i-pin", 13)} Unpin</button>
       <button class="rng-open" data-open="${slot.id}">Details</button>`
    : `<button class="rng-re" data-reroll="${slot.id}">${icon("i-refresh", 13)} Re-roll</button>
       ${rngIsPlaying(row)
         ? `<button class="rng-open" data-pinnow="${slot.id}" title="Hold this slot: it stops rolling until you unpin it">${icon("i-pin", 13)} Pin</button>`
         : ""}
       <button class="rng-open" data-open="${slot.id}">Details</button>`;

  return box(`<div class="rng-art">${card}</div>
    <div class="rng-body">
      <h3 title="${escapeHtml(String(row.title))}">${escapeHtml(String(row.title))}</h3>
      <div class="rng-chips">${pinned ? rngPlayingChip() : ""}${copy}${time}${rngChipsHtml(row)}</div>
      <div class="rng-acts">${acts}</div>
      ${pinned ? "" : rngPinMenuHtml(slot.id)}
    </div>`, pinned ? " rng-pinned" : "");
}

const rngPlayingChip = () =>
  `<span class="rng-copy playing">${icon("i-play", 11)} Now playing</span>`;

/* The other way in: every game the sheet marks Playing, so a lane can be filled by a
   playthrough that started long before this tab rolled anything.

   Two groups, because which slot a game fits is inferred (rngSlotOf) and inference gets
   things wrong — the ones this slot would have rolled come first, and the rest are still
   listed rather than hidden. Pinning from a slot pins to THAT slot whatever the classifier
   thought, because the three lanes are yours to shape and a game with no known year would
   otherwise be pinnable nowhere at all. */
function rngPinMenuHtml(slotId) {
  const rows = rngPlayingRows().filter((r) => !Object.values(rngPinKeys()).includes(r._k));
  if (!rows.length) return "";
  const opt = (r) => `<option value="${escapeHtml(String(r._k))}">${escapeHtml(String(r.title))}${
    r.platform ? ` · ${escapeHtml(String(r.platform))}` : ""}</option>`;
  const fits = rows.filter((r) => rngSlotOf(r) === slotId);
  const rest = rows.filter((r) => rngSlotOf(r) !== slotId);
  return `<div class="rng-pinsel">
      <select data-pin="${slotId}" aria-label="Pin a game you're playing to this slot">
        <option value="">Pin a game you're playing…</option>
        ${fits.length ? `<optgroup label="Fits this slot">${fits.map(opt).join("")}</optgroup>` : ""}
        ${rest.length ? `<optgroup label="Other games you're playing">${rest.map(opt).join("")}</optgroup>` : ""}
      </select>
    </div>`;
}

/* The copy you'd actually reach for. Physical is the one thing this mode weights the roll
   on, so the card says whether that's what won rather than leaving you to open the drawer,
   and a game that's playable without being owned has to say so too, or the badge would
   call an emulated ROM "Digital" and read as a copy you have. */
function rngCopyChip(row) {
  if (!row.owned)
    return `<span class="rng-copy none">${icon("i-alert", 11)} ${row.wishlisted ? "Wishlisted" : "Not owned"}</span>`;
  return rngOwnedPhysical(row)
    ? `<span class="rng-copy phys">${icon("i-package", 11)} On the shelf</span>`
    : `<span class="rng-copy">${icon("i-play", 11)} Digital</span>`;
}

/* How long it takes to beat. It's the question that decides whether tonight's pick is
   tonight's pick, and it was a click away in the drawer. playtimeOf is the same chain the
   rest of the app uses (HowLongToBeat, then VNDB for visual novels, then the sheet's own
   estimate), and the chip stays off the card entirely when nothing knows: a blank clock
   reads as "zero hours", which is worse than not saying. It arrives with enrichment, so
   rngPatch re-renders this row rather than leaving a card that never learns. */
function rngTimeChip(row) {
  const hrs = playtimeOf(row);
  return hrs != null
    ? `<span class="chip rng-time" title="How long to beat">${icon("i-clock", 11)} ${escapeHtml(fmtHours(hrs))}</span>`
    : "";
}

const rngChipsHtml = (row) => [row.platform, rngYear(row) || null, row.genre]
  .filter((x) => x != null && x !== "")
  .map((x) => chipHtml(x)).join("");

// A slot mid-load: the same box, the same eyebrow, and a shimmer where the count, the
// cover and the title will be. Shaped like the card it becomes, so nothing jumps.
function rngSkeletonHtml(slot) {
  return `<div class="rng-slot loading" data-slot="${slot.id}" style="--slot: ${slot.tint}">
    <div class="rng-head">
      <span class="rng-eye">${icon(slot.icon, 12)} ${escapeHtml(slot.label)}</span>
      <span class="rng-n skel"></span>
    </div>
    <div class="rng-art"><div class="rng-skel-art skel"></div></div>
    <div class="rng-body">
      <div class="skel skel-line"></div>
      <div class="skel skel-line short"></div>
    </div>
  </div>`;
}

function rngResultHtml() {
  if (rngLoading())
    return `<div class="rng-grid">${RNG_SLOTS.map(rngSkeletonHtml).join("")}</div>`;
  const pools = rngPools();
  const total = RNG_SLOTS.reduce((n, s) => n + pools[s.id].length, 0);
  // An empty library empties the grid — unless a slot is pinned, in which case there IS
  // something to show and hiding it would lose the card holding the pin.
  if (!total && rngFreeSlots().length === RNG_SLOTS.length) {
    return `<div class="pick-empty">Nothing in your library clears all three slots with these criteria.</div>`;
  }
  return `<div class="rng-grid">${RNG_SLOTS.map((s) => rngSlotHtml(s, pools[s.id])).join("")}</div>`;
}

/* An enrichment batch landed and real cards are already on screen. Update what moved
   instead of rebuilding the grid.

   Rebuilding is what the autoplay tour cannot survive: preview.js walks the .card elements
   and holds the one it is playing, so replacing those nodes mid-tour strands it and the
   tour stops partway through the three. A backfill poll every 45 seconds was doing exactly
   that. So the .card stays put and only its contents change — the counts, a cover that has
   just arrived, the score badges in the body, and the chip row, which carries the time to
   beat and therefore only fills in once HowLongToBeat has answered. */
function rngPatch() {
  const host = $("#pickResult");
  if (!host) return;
  const pools = rngPools();
  for (const s of RNG_SLOTS) {
    const el = host.querySelector(`.rng-slot[data-slot="${s.id}"]`);
    if (!el) continue;
    const pinned = rngIsPinned(s.id);
    // A pinned slot's eyebrow says "Pinned", not a count — leave it alone rather than
    // overwriting the badge with the pool it isn't rolling from.
    const n = pinned ? null : el.querySelector(".rng-n");
    if (n) n.textContent = pools[s.id].length.toLocaleString();
    const row = rngState.picks[s.id];
    if (!row) continue;
    const rec = igdbRecOf(row);
    const cs = coverSrc(rec, "cover_big");
    // A placeholder that can stop being one. Swapped in place so the .card around it,
    // which is what the tour is holding, is the same node it was.
    const ph = el.querySelector(".rng-art .card-cover.ph");
    if (cs && ph) {
      const img = document.createElement("img");
      img.className = "card-cover" + (coverIsPixelArt(rec, cs) ? " pixel" : "");
      img.alt = "";
      img.src = cs;
      ph.replaceWith(img);
    }
    const body = el.querySelector(".rng-art .card-body");
    if (body) body.innerHTML = cardBodyHtml(row);
    const chips = el.querySelector(".rng-chips");
    if (chips) chips.innerHTML = (pinned ? rngPlayingChip() : "")
      + rngCopyChip(row) + rngTimeChip(row) + rngChipsHtml(row);
  }
  const total = rngPoolCount();
  const c = document.querySelector("#picker .pick-count");
  if (c) c.textContent = `${total.toLocaleString()} game${total === 1 ? "" : "s"} in pool`;
}

function rngReelHtml(pool, picked) {
  const others = pool.filter((r) => r !== picked);
  const draw = () => (others.length ? others[Math.floor(Math.random() * others.length)] : picked);
  const seq = Array.from({ length: RNG_REEL_N }, (_, i) => (i === RNG_REEL_LAND ? picked : draw()));
  return `<div class="rng-reel-mask">
      <div class="rng-reel">${seq.map((r, i) => pickRollTile(r, i === RNG_REEL_LAND)).join("")}</div>
      <div class="rng-reel-hi"></div>
    </div>`;
}

function playRngRoll(pools) {
  const host = $("#pickResult");
  if (!host) { renderPicker(); return; }
  const my = ++_rngRollN;
  // A pinned column doesn't spin: it keeps its card while the free ones roll beside it,
  // which is the whole picture the mode is drawing — two lanes being decided, one already
  // under way. It's rendered by the same rngSlotHtml the landed grid uses, so nothing in
  // that column moves when the roll finishes.
  const live = RNG_SLOTS.filter((s) => !rngIsPinned(s.id) && rngState.picks[s.id]);
  const last = RNG_REEL_BASE + RNG_REEL_STAGGER * (live.length - 1);

  host.innerHTML = `<div class="rng-grid">${RNG_SLOTS.map((s) => {
    if (rngIsPinned(s.id)) return rngSlotHtml(s, pools[s.id]);
    const picked = rngState.picks[s.id];
    const head = `<div class="rng-head"><span class="rng-eye">${icon(s.icon, 12)} ${escapeHtml(s.label)}</span></div>`;
    const body = picked
      ? rngReelHtml(pools[s.id], picked)
      : `<div class="rng-blank"><span class="rng-blank-ico">${icon("i-alert", 24)}</span><p>Nothing fits.</p></div>`;
    return `<div class="rng-slot spinning" data-slot="${s.id}" style="--slot: ${s.tint}">
        ${head}${body}<div class="rng-word">${picked ? "Rolling…" : "—"}</div>
      </div>`;
  }).join("")}</div>`;

  pickWireRollTiles(host);
  // The pinned cards were just painted as real cards; give them their real behaviour
  // (cover trailer, drawer, Unpin) rather than leaving them inert until the reels stop.
  wireRngResult();
  live.forEach((s, i) => {
    const el = host.querySelector(`.rng-slot[data-slot="${s.id}"]`);
    const dur = RNG_REEL_BASE + RNG_REEL_STAGGER * i;
    rngSpin(el.querySelector(".rng-reel-mask"), dur);
    setTimeout(() => {
      if (_rngRollN !== my) return;
      rngLockSlot(el, rngState.picks[s.id]);
    }, dur - 40);
  });

  setTimeout(() => {
    if (_rngRollN !== my || activeTab !== "pick") return;
    rngLandCards(live.map((s) => s.id));
  }, last + RNG_REEL_TAIL);
}

function playRngSlotRoll(el, slot, picked, pool) {
  const my = ++_rngRollN;
  const dur = RNG_REEL_BASE;
  el.classList.add("spinning");
  el.querySelector(".rng-art")?.remove();
  el.querySelector(".rng-body")?.remove();
  el.insertAdjacentHTML("beforeend", rngReelHtml(pool, picked) + `<div class="rng-word">Rolling…</div>`);
  pickWireRollTiles(el);
  rngSpin(el.querySelector(".rng-reel-mask"), dur);
  setTimeout(() => {
    if (_rngRollN !== my) return;
    rngLockSlot(el, picked);
  }, dur - 40);
  setTimeout(() => {
    if (_rngRollN !== my || activeTab !== "pick") return;
    rngLandCards([slot.id]);
  }, dur + RNG_REEL_TAIL);
}
