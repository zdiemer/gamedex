# Brag Plan: Gamedex

## What is this app?
A self-hosted webapp that mirrors one Dropbox spreadsheet — the "Games Master List" — and turns
14,387 rows of games into a faceted, cover-art collection browser with a rating-prediction
recommender and a force-directed franchise galaxy. No database, no build step, no bundler.

## The angle
The escalation is the joke, and it's all true. It starts as a spreadsheet. It is *still* a
spreadsheet — the app polls an `.xlsx` on a shared link every 600 seconds and holds the whole
dataset in memory. And on top of that spreadsheet there is now a 369,802-game IGDB mirror, a
model that predicts what you'd rate a game you don't own, and a 3,000-star galaxy coloured by
franchise. Nobody asked for any of this. The video is the straight-faced escalation from
"it's a spreadsheet" to "3,000 stars · 9,313 links", landing back on "still just a spreadsheet."

Specific to this project because every number, label, facet count, game title and colour in the
video is lifted from the real app: `static/style.css` tokens, the real Archivo/Plex webfonts out
of `static/fonts/`, the real facet counts, the real galaxy stat line, the real prediction copy.

## Hook (first 2-3 seconds)
A boring spreadsheet grid — grey gridlines, a column header row, game titles in cells — sitting
on Gamedex's near-black. One line lands on the downbeat:

**"It's a spreadsheet."**

That's the hook because it's an anticlimax. It buys the next 18 seconds by promising nothing.

## Key moments (the middle)
- **The grid becomes a cover wall.** The spreadsheet cells snap into the real My Games cover
  grid and the row counter runs `1 → 14,387`. The wordmark lands with it.
- **The facet sidebar counts itself in.** `PC 5,279` / `Nintendo Switch 948` / `SNES 449` arrive
  one by one out of the real platform facet, under `165 platforms · 288 pages`. The point:
  all of it filters client-side, over a ~1 MB payload.
- **It recommends games you don't own.** Three real recommendation cards arrive — `~88% predicted`,
  `Because you liked Yakuza 0` — over the real claim: **369,802 in the catalogue. 14,387 are yours.**
  This is the one feature that can't be faked by re-ranking a backlog, so it gets the most room.
- **The galaxy.** The real Galaxy view: `3,000 stars · 9,313 links · coloured by franchise`, the
  franchise legend (Mario 58, Dungeons & Dragons 51, Final Fantasy 45) glowing in.

## Outro / punchline
The galaxy dims, the wordmark lands, and the line returns to where it started:

**Gamedex**
**Still just a spreadsheet.**
`games.diemer.codes`

## User flow worth showing
The real path through the app, entry → key action → result:
1. **Entry** — land on the collection: the cover wall, 14,387 games, `data as of Aug 25, 2026`.
2. **Key action** — narrow it: tick a platform facet, watch the count and the grid respond
   instantly (client-side faceting, no round-trip).
3. **Result** — the app answers back with something you *don't* own: a recommendation card with a
   predicted score and a reason ("Because you liked Yakuza 0"), then the galaxy view of how the
   whole collection connects.

Scenes 2–5 are that flow. Only the hook is not the working app, and it is the spreadsheet the
working app is made of — which is the premise, not filler.

## Tone
- Preset: `default`
- Creative direction: "a spreadsheet that got out of hand"
- Interpretation: playful but never goofy — the product is genuinely well-built, so the energy is
  warm and confident with comfortable 3–5s scenes and clean crossfades. The humour comes entirely
  from the gap between "spreadsheet" and what's on screen; no jokes are written, only true numbers
  shown in escalating order. Typography is mixed case, Archivo 800 for display, Plex for data.

## Format: landscape — 1920x1080
## Duration: 21s target (5 scenes)

## Visual identity (from the project)
- Background: `#0a0c11` (`--bg`), panels `#151922` (`--surface`), `#1c212c` (`--surface-2`)
- Border: `#232a37` (`--border`)
- Text: `#e9edf4` (`--text`), muted `#8a94a6` (`--muted`), dim `#5b657a` (`--dim`)
- Accent: `#7c5cff` (`--accent`), secondary accent `#22d3ee` (`--accent-2`)
- Accent line/glow: `rgba(124,92,255,.45)`, `0 10px 34px rgba(124,92,255,.20)` (`--glow`)
- Good/warn: `#34d399` (`--good`), `#fbbf24` (`--warn`)
- Radius: 12px (`--r`), 8px (`--r-sm`), 16px (`--r-lg`); ease `cubic-bezier(.2,.8,.2,1)`
- Display font: **Archivo 800** — `static/fonts/archivo-800.woff2` (copy into composition assets)
- Body font: **IBM Plex Sans** ("Plex", weight 100–700) — `static/fonts/plex-sans.woff2`
- Strongest visual element: the violet-on-near-black cover wall, and the Galaxy view's coloured
  franchise clusters on `#0a0c11` — the one screen in the app that is already cinematic.
- Real asset available: `docs/shots/galaxy.jpg` (3000x1900, genuinely dark-theme) — usable directly.
  The other shots in `docs/shots/` are light-theme and must NOT be used; recreate those in HTML
  with the dark tokens above instead.

## Share copy (draft)
I built a webapp on top of a Dropbox spreadsheet. It now has 14,387 games, a model that guesses
what I'd rate things I don't own, and a 3,000-star galaxy. It is still, technically, a spreadsheet.

## Audio direction
- Role: warm bed with sparse, motion-matched accents
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM) — chosen because its
  strong cues are spread across the whole 0–25s window (1.60 / 3.70 / 5.80 / 8.96 / 12.65 / 17.91),
  which matches this video's evenly-escalating reveals. The other bundled tracks cluster their
  strong cues after 15s.
- Music treatment: start at 0 under the hook at low volume (~0.35), open up on the cover-wall
  reveal, hold through the middle, and fade out under the final wordmark so the last SFX rings.
- Music cue guidance: preset read from
  `~/.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json`.
  - Strong cues to target: **1.60s** (hook line), **3.70s** (cover-wall reveal), **8.96s**
    (recommendation payoff). Lock those three; leave the rest natural.
  - Beat grid (0.52s spacing) for sequential reveals — facet rows around 5.80 / 6.86 / 7.91
    (every other beat, so text is readable), recommendation cards around 8.96 / 10.01 / 11.06.
- Audio-reactive treatment: subtle. Use music RMS/bass only to breathe the violet glow behind the
  cover wall and the star brightness in the galaxy scene. No waveform bars, no equalizers, no
  particles, no strobing.
- SFX posture: sparse and dry. Interface ticks for the facet rows, card-like arrivals for the
  recommendation cards, one short announcement cue on the galaxy reveal, nothing on the hook.
- Audio-coupled moments: the `1 → 14,387` count-up, the three facet rows arriving one by one,
  the three recommendation cards arriving one by one, the galaxy's `3,000 / 9,313` counters.
- Restraint rule: no SFX at all during the hook — the anticlimax needs to be quiet. Never more
  than one sound per beat, and nothing bright or metallic; this app's design language is muted.

## Storyboard

### Scene 1 — "It's a spreadsheet." — 3.0s
On `#0a0c11`: a plain spreadsheet grid, `#232a37` gridlines, a header row reading
`Title · Platform · Release Date · Completed · Rating` in `#8a94a6`, and four rows of real titles
from the sheet (`Atlyss`, `Gloomwood`, `Sky: Children of the Light`, `Repetendium`) in Plex at
small size. Deliberately unglamorous. The line **"It's a spreadsheet."** sets in Archivo 800,
centre, and holds. Nothing moves except a slow, barely-there drift on the grid.
Sequential/interaction: none — the stillness is the point.
Audio intent: music only, low. Empty and dry, so the next scene can open up.
Audio-coupled idea: none. No SFX in this scene.
Music: warm bed at low volume, entering at 0.
Transition mood: clean → Scene 2 (the grid cells snap into cover tiles rather than cutting)

### Scene 2 — The collection — 4.0s
The grid's cells transform into the real My Games cover wall: a 5-across grid of cover tiles with
the real title/platform captions (`Atlyss — PC · Early Access`, `Gloomwood — PC · Early Access`,
`Dimensional Slaughter`, `Genesis Survivors`, `Sky: Children of the Light`). The **Gamedex**
wordmark lands top-left with the real violet app icon; a counter runs **1 → 14,387** and settles
on `14,387 games`; `data as of Aug 25, 2026` sits small and muted. Violet glow (`--glow`) breathes
behind the grid.
Sequential/interaction: yes — tiles arrive as a quick staggered wave (not one-by-one; the wave is
the "14,387" feeling), then the counter ticks up and settles.
Audio intent: the room opens. This is the first payoff.
Audio-coupled idea: the count-up ticks; one dry accent as the wordmark lands.
Music: opens to full bed. **Beat-lock the wordmark/cover-wall reveal to the 3.70s strong cue.**
Transition mood: clean slide → Scene 3

### Scene 3 — It filters itself — 4.0s
The cover wall slides right; the real facet sidebar slides in from the left on `--facet-bg`, header
`PLATFORM` in Archivo caps with a filter input below. Three real facet rows arrive one by one with
their real counts: **PC 5,279**, **Nintendo Switch 948**, **SNES 449**. The PC checkbox ticks
itself violet and the grid behind reflows. Under it, in Plex: **165 platforms · 288 pages · all of
it filtered in your browser.** The full set holds on screen after the last row lands.
Sequential/interaction: yes — three facet rows one by one, then a simulated checkbox tick on `PC`
and a reflow of the grid behind it.
Audio intent: mechanical and satisfying — the feeling of data being cut.
Audio-coupled idea: a soft interface tick per facet row, a slightly firmer one on the checkbox.
Music: steady bed. **Beat-grid the rows on every other beat: 5.80 / 6.86 / 7.91.**
Transition mood: clean → Scene 4

### Scene 4 — It recommends things you don't own — 4.5s
Full-width dark panel. Header in Archivo: **You'd probably love**. Three real recommendation cards
arrive one by one, each a cover tile with the real caption and the real predicted-score chip:
`The Elder Scrolls IV: Oblivion Remastered — Nintendo Switch 2 · 2026 — ~88% predicted`,
`Seiken Densetsu 3 — SNES · 1995 — ~87% predicted`,
`The Elder Scrolls V: Skyrim — PC · 2011 — ~85% predicted`.
These three cards are cropped straight out of `docs/shots/home.jpg`, so the cover art, the caption
and the predicted-score chip on each card are the app's own rendering, not a recreation.
A reason chip fades in under the middle card: **"Because you liked Yakuza 0"**. Then the claim
lands, big, in Archivo: **369,802 in the catalogue. 14,387 are yours.**
Sequential/interaction: yes — three cards one by one, each with a card-arrival sound; the reason
chip is a separate later beat so it is read, not skimmed.
Audio intent: confident escalation. This is the argument, so it gets the biggest accent.
Audio-coupled idea: card-place per card; the `369,802` line lands on the strong cue.
Music: full. **Beat-lock the first card / claim landing to the 8.96s strong cue; cards on the beat
grid 8.96 / 10.01 / 11.06.**
Transition mood: soft crossfade → Scene 5 (into black, so the galaxy can bloom out of it)

### Scene 5 — Galaxy, and the sign-off — 5.5s
The real Galaxy view (`docs/shots/galaxy.jpg`) blooms up out of black with a slow push-in on the
cluster. The real stat line types/counts along the top: **3,000 stars · 9,313 links · coloured by
franchise**, and three legend rows glow in at their real colours — `Mario 58` (blue),
`Dungeons & Dragons 51` (orange), `Final Fantasy 45` (green). Star brightness breathes subtly with
the music. At ~3.0s into the scene the galaxy dims to near-black and the sign-off lands:
**Gamedex** in Archivo 800, **Still just a spreadsheet.** in Plex beneath it, and
`games.diemer.codes` small, muted, last.
Sequential/interaction: yes — the two counters run up, then three legend rows glow in.
Audio intent: the widest moment, then deliberate collapse to quiet for the punchline.
Audio-coupled idea: one short announcement cue on the galaxy bloom; the counters tick; then
silence under the wordmark except the music's tail.
Music: full through the galaxy, **beat-lock the galaxy bloom to the 12.65s strong cue**, then fade
out across the last ~1.5s so "Still just a spreadsheet." reads in near-silence.
Transition mood: dramatic dim → end

**Total: 3.0 + 4.0 + 4.0 + 4.5 + 5.5 = 21.0s**

**Music mood for this video:** upbeat, warm, confident — a working-software bed, not a hype bed.
**Audio summary:** Opens nearly bare under a deliberately boring spreadsheet, blooms on the cover
wall, ticks mechanically through the facets, peaks on the recommendation claim and the galaxy, then
drops away entirely so the last line — "Still just a spreadsheet." — lands in the quiet it needs.

---

## As shipped (deviations from the plan above)

Recorded here rather than by quietly editing the plan, so the two can be compared.

- **Final timings: 3.4 / 4.1 / 4.1 / 5.4 / 5.6 = 22.6s** (plan said 3.0 / 4.0 / 4.0 / 4.5 / 5.5 = 21.0s).
  The scene boundaries were re-cut onto the track's actual beat grid so the three strong-cue locks
  and both beat-grid runs could land without any text falling under its reading floor. 22.6s is
  still inside the 15–25s law.
- **Scene 1 is stacked, not overlaid.** The plan had the hook line centred *over* the dimmed sheet.
  `hyperframes check` flagged that as `content_overlap` against live text, and it was right — the
  headline box sat on the sheet's rows. The line now sits above the sheet in its own band, which
  also removed the need for the scrim and for two layout opt-outs. It reads better: statement, then
  evidence.
- **Scene 5's franchise legend is the app's own, not a recreation.** The plan had three legend rows
  glowing in one by one. The real Galaxy screenshot already contains the real legend — `Mario 58`,
  `Dungeons & Dragons 51`, `Final Fantasy 45` and nine more — so the shot is framed to keep it
  instead of fabricating rows beside it. Sequential text there would also have had to sit on
  consecutive 0.52s beats to fit the scene, which is below the reading floor.
- **Third recommendation card is Skyrim (`~85% predicted`), not Castlevania (`~86%`).** The
  Castlevania tile in `docs/shots/home.jpg` carries a video-preview pause overlay, and the two
  Oblivion entries would have read as a duplicate-render bug. Skyrim is the next real card.
- **The galaxy shot is cropped to its canvas.** `docs/shots/galaxy.jpg` has the app's *light-theme*
  top bar and toolbar; only the canvas is dark. The crop (`2150x1209+0+639`) drops both bars and the
  bottom-right "drag to pan" hint, keeps the whole legend, and the real toolbar's stat string is
  re-set in Archivo/Plex as an overlay instead.
- **Audio data was extracted with a Node port, not `extract-audio-data.py`.** That script needs
  numpy and this pod is rootless with no pip and no uv, so there is no way to install it.
  `tools/extract-audio-data.mjs` is a faithful reimplementation — same decode, window, band edges
  and two-pass global normalisation — and its header says so. Verified in the encoded output: the
  bloom margin's mean luma moves 34.3 → 37.0 → 35.1 after its entrance tween has finished, so the
  per-frame callbacks really do run during render.
- **SFX are the `card-slide` variants, not `card-place`.** `sfx-analysis.md` rates `card-place` as
  high high-frequency risk, and these three hits repeat; `card-slide-1/2/3` are the medium-risk
  picks it recommends first for sequential items.
- **One lint warning is left standing:** `composition_file_too_large` (381 lines). Splitting five
  short scenes into sub-compositions would cost more in indirection than it buys here. It is a
  warning, not an error, and plain `check` passes.
