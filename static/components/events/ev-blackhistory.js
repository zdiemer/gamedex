"use strict";

// UI components for ev-blackhistory.js. Feature state and orchestration remain in that module.

function bhmRender(host) {
  const ev = EV.byId.blackhistory;
  const { rows, studios, done, ready } = bhmStats();
  const rate = (row) => typeof combinedRating === "function"
    ? (combinedRating(row) ?? 0)
    : (row.metacriticRating || 0);
  const bucket = (row) => row.completed ? 2 : row.playable === "Yes" ? 0 : 1;
  const sorted = rows.slice().sort((a, b) =>
    bucket(a) - bucket(b) || rate(b) - rate(a) ||
    String(a.title).localeCompare(String(b.title)));

  host.innerHTML = evHeroHtml(ev, {
    note: rows.length
      ? `${rows.length.toLocaleString()} games · ${studios.toLocaleString()} studios · ${ready.toLocaleString()} unfinished and playable`
      : "No games from the curated studio list are on the sheet yet.",
  }) + `<div class="ev-wrap">
    ${rows.length ? `<div class="ev-yearbook">${sorted.map((row) => {
      const makers = bhmStudios(row).join(" · ");
      const badge = row.completed
        ? `<span class="ev-badge done">finished</span>`
        : row.playable === "Yes"
          ? `<span class="ev-badge own">ready to play</span>`
          : row.owned
            ? `<span class="ev-badge wish">on the shelf</span>`
            : "";
      return `<div class="ev-yb">${evTileHtml(row, { sub: makers })}${badge}</div>`;
    }).join("")}</div>`
    : `<p class="ev-none">The spotlight will fill as games from its curated studios reach the sheet.</p>`}
    <p class="ev-note">This lens uses an explicit, reviewable studio list. It never guesses identity
      from a name or location. Sources include the
      <a href="https://www.blackgamedevs.com/" target="_blank" rel="noreferrer">Black Game Developers directory</a>
      and <a href="https://news.xbox.com/en-us/2024/02/01/xbox-and-gameheads-amplifying-black-voices-in-gaming/"
      target="_blank" rel="noreferrer">Xbox and Gameheads' Black creator spotlight</a>.</p>
  </div>`;

  if (typeof maybeEnrich === "function") maybeEnrich(sorted.slice(0, 60));
}
