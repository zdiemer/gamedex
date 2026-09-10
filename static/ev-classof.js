"use strict";

/* Class of 'XX — the anniversary dial.

   The cheapest event on the board and the only one that is a LENS rather than a list. It
   points at a column the sheet already keeps (releaseYear), spins to a year, and shows you
   that year's intake. No pool predicate, no draw, no deadline, and one integer of state.

   Two things make it worth its own tab rather than a filter preset. It is the only event
   that draws mostly from games you do NOT own — 324 of the 2001 rows are on the sheet and
   32 of them are yours — so it feeds the wishlist rather than the backlog. And it is the
   only one that can put a FINISHED game back in front of you: a 25th birthday is a fine
   reason to replay something, which every other event here is structurally unable to
   suggest. */

const CLASSOF_RUNGS = [5, 10, 15, 20, 25, 30, 35, 40];
const CLASSOF_DEFAULT = 25;

const classofState = () => {
  const st = evState("classof");
  if (!st.dial) st.dial = evNow().getFullYear() - CLASSOF_DEFAULT;
  return st;
};
// The name changes every January, which is the whole idea, so it is computed and never typed.
const classofName = (y) => `Class of ’${String(y % 100).padStart(2, "0")}`;
const classofRows = (y) => evPool("classof-" + y, (r) => +r.releaseYear === +y);

function classofSet(y) {
  const st = classofState();
  st.dial = Math.max(1958, Math.min(evNow().getFullYear(), +y));
  evSave();
}

function classofStats(y) {
  const rows = classofRows(y);
  return {
    rows,
    owned: rows.filter((r) => r.owned).length,
    done: rows.filter((r) => r.completed).length,
  };
}

function classofRender(host) {
  const ev = EV.byId.classof;
  const st = classofState();
  const year = st.dial;
  const now = evNow().getFullYear();
  const { rows, owned, done } = classofStats(year);
  const rate = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : (r.metacriticRating || 0));
  const sorted = rows.slice().sort((a, b) => rate(b) - rate(a));
  const shown = sorted.slice(0, 60);

  const rungs = CLASSOF_RUNGS.map((n) => {
    const y = now - n;
    const c = classofRows(y).length;
    return `<button class="ev-rung${y === year ? " on" : ""}" data-classof="${y}">
      <b>${y}</b><span>${n} years</span><i>${c ? c.toLocaleString() + " games" : "nothing yet"}</i>
    </button>`;
  }).join("");

  host.innerHTML = evHeroHtml(ev, {
    acts: `<button class="btn ghost" data-classof="${year - 1}">← ${year - 1}</button>
           <span class="ev-dial-y">${year}</span>
           <button class="btn ghost" data-classof="${year + 1}"${year >= now ? " disabled" : ""}>${year + 1} →</button>`,
    note: `${rows.length.toLocaleString()} on the sheet · ${owned.toLocaleString()} owned · ${done.toLocaleString()} finished`,
  }) + `<div class="ev-wrap">
    <div class="ev-rungs">${rungs}</div>
    ${rows.length ? `<div class="ev-yearbook">${shown.map((r) => {
      const badge = r.completed ? `<span class="ev-badge done">finished</span>`
        : r.owned ? `<span class="ev-badge own">owned</span>`
        : r.wishlisted ? `<span class="ev-badge wish">wishlisted</span>` : "";
      const mc = r.metacriticRating != null ? Math.round(+r.metacriticRating * 100) : null;
      return `<div class="ev-yb">${evTileHtml(r, { sub: `${r.platform || ""}${mc != null ? " · " + mc : ""}` })}${badge}</div>`;
    }).join("")}</div>
    ${sorted.length > shown.length ? `<p class="ev-more">${(sorted.length - shown.length).toLocaleString()} more from ${year}.</p>` : ""}`
    : `<p class="ev-none">Nothing on the sheet was released in ${year}. The dial runs out somewhere around 1981.</p>`}
  </div>`;

  host.querySelectorAll("[data-classof]").forEach((el) => {
    el.onclick = () => { classofSet(el.dataset.classof); classofRender(host); evWireTiles(host); };
  });
  if (typeof maybeEnrich === "function") maybeEnrich(shown);
}

evRegister({
  id: "classof",
  name: "Class of ’01",
  icon: "i-cartridge",
  structure: "Dial",
  priority: 80,
  window: { from: [1, 1], to: [1, 31] },
  core: { from: [1, 1], to: [1, 31] },
  cta: "Open the yearbook",
  blurb: "one year of the collection, twenty-five years on",
  offSeason: "The yearbook is open all year. The banner only turns up in January, when the class rolls over.",
  skin: "--ev-disp:'Press Start 2P',var(--display);--ev-size:30px;--ev-dw:400;--ev-ls:0;" +
        "--ev-deco:#f5d76e;--ev-fg:#f2ecd8;--ev-fg-2:#b9b49c;--ev-edge:rgba(245,215,110,.32);" +
        "--ev-edge-hi:rgba(245,215,110,.66);--ev-glow:rgba(245,215,110,.3);--ev-t1:#fff8dd;" +
        "--ev-t2:#f5d76e;--ev-t3:#e0a92b;--ev-on-cta:#1a1405;--ev-k:#f5d76e;" +
        "--ev-art:repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,transparent 1px 3px)," +
        "radial-gradient(110% 150% at 84% 120%,rgba(236,72,153,.20),transparent 58%)," +
        "radial-gradient(90% 130% at 6% -20%,rgba(34,211,238,.18),transparent 60%)," +
        "linear-gradient(140deg,#050912,#0a1122 70%,#0d1526)",
  deco: [
    { i: "i-crt", x: 86, y: 66, s: 44, lift: 12 },
    { i: "i-cartridge", x: 70, y: 24, s: 28, r: 8, lift: 11, d: 90 },
    { i: "i-stick", x: 46, y: 20, s: 24, r: -8, lift: 14, d: 30 },
    { i: "i-disc", x: 71, y: 82, s: 24, lift: 9, d: 150, o: .6 },
    { i: "i-hourglass", x: 47, y: 84, s: 18, lift: 8, d: 220, o: .55 },
    { i: "i-star", x: 57, y: 12, s: 16, lift: 16, d: 190, o: .5 },
  ],
  blank: () => ({ dial: 0 }),
  merge: (mine, theirs) => false,     // where the dial points is a per-device view, not work
  title: () => classofName(evNow().getFullYear() - CLASSOF_DEFAULT),
  eyebrow: () => `Rolling event · ${CLASSOF_DEFAULT} years on`,
  pitch: () => {
    const y = evNow().getFullYear() - CLASSOF_DEFAULT;
    const { rows, owned, done } = classofStats(y);
    if (!rows.length) return `Nothing on the sheet turned ${CLASSOF_DEFAULT} this year.`;
    return `${rows.length.toLocaleString()} games on the sheet turned ${CLASSOF_DEFAULT} this year. You own ${owned}, and you have finished ${done}.`;
  },
  meter: () => {
    const y = evNow().getFullYear() - CLASSOF_DEFAULT;
    const { rows, owned, done } = classofStats(y);
    return { pct: null, text: `${rows.length.toLocaleString()} in the class · ${owned} owned · ${done} finished` };
  },
  render: classofRender,
  reset: () => {},
});

// The registered name is a placeholder for the year the app happens to be running in: the
// tab, the banner and the palette all read ev.name, and hard-coding ’01 would be wrong the
// moment the calendar turns over.
EV.byId.classof.name = classofName(new Date().getFullYear() - CLASSOF_DEFAULT);
