# Hyperframes Composition Brief: Gamedex

## Objective
Create a short launch-style brag video for Gamedex — a self-hosted webapp that turns one Dropbox
spreadsheet into a faceted, cover-art game collection with a rating-prediction recommender and a
force-directed franchise galaxy.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21 seconds (5 scenes: 3.0 / 4.0 / 4.0 / 4.5 / 5.5)

## Source Material
- Project root: `/home/node/code/gamedex`
- Primary files read: `README.md`, `static/index.html`, `static/style.css`, `static/fonts/`,
  `docs/shots/*.jpg`
- Product name: **Gamedex**
- Tagline / strongest claim: **369,802 in the catalogue. 14,387 are yours.**
- Key UI moments to recreate: the My Games cover wall with its row count; the platform facet
  sidebar with real counts; the "You'd probably love" recommendation row with predicted-score
  chips; the Galaxy view's stat line and franchise legend.
- Copy that must appear verbatim:
  - `It's a spreadsheet.`
  - `14,387 games`
  - `data as of Aug 25, 2026`
  - `PLATFORM` / `PC 5,279` / `Nintendo Switch 948` / `SNES 449`
  - `165 platforms · 288 pages · all of it filtered in your browser.`
  - `You'd probably love`
  - `Because you liked Yakuza 0`
  - `369,802 in the catalogue. 14,387 are yours.`
  - `3,000 stars · 9,313 links · coloured by franchise`
  - `Mario 58` / `Dungeons & Dragons 51` / `Final Fantasy 45`
  - `Gamedex` / `Still just a spreadsheet.` / `games.diemer.codes`

## Creative Direction
- Tone preset: `default`
- Creative direction: "a spreadsheet that got out of hand"
- Interpretation: playful but never goofy. The product is genuinely well-built, so the energy is
  warm and confident — comfortable 3–5s scenes, clean crossfades and slides, no hard cuts, no
  caps-lock typography. All humour comes from the escalation of true numbers; write no jokes.
- Angle: it starts as a spreadsheet and it is *still* a spreadsheet — the app polls an `.xlsx` on a
  Dropbox shared link and keeps the whole dataset in memory. On top of that spreadsheet there is
  now a 369,802-game IGDB mirror, a model that predicts what you'd rate a game you don't own, and
  a 3,000-star galaxy coloured by franchise. The video is the straight-faced climb from
  "it's a spreadsheet" to the galaxy, then the landing back on "still just a spreadsheet."
- Hook (0–3s): a deliberately boring spreadsheet grid on near-black, with the line
  **"It's a spreadsheet."** The anticlimax is the hook.
- Outro / punchline: **Gamedex** / **Still just a spreadsheet.** / `games.diemer.codes`
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - The light-theme screenshots in `docs/shots/` as full-frame backdrops (see Visual Identity)

## Visual Identity
Taken verbatim from `static/style.css` `:root` (the app's dark default):
- Background: `#0a0c11` (`--bg`); alt `#0e1117` (`--bg-2`)
- Surfaces: `#151922` (`--surface`), `#1c212c` (`--surface-2`), `#232a37` (`--surface-3`)
- Border: `#232a37` (`--border`); soft `#1a1f2a` (`--border-soft`)
- Text: `#e9edf4` (`--text`); muted `#8a94a6` (`--muted`); dim `#5b657a` (`--dim`)
- Accent: `#7c5cff` (`--accent`); accent-2 `#22d3ee` (`--accent-2`);
  accent-soft `rgba(124,92,255,.16)`; accent-line `rgba(124,92,255,.45)`
- Good `#34d399`, warn `#fbbf24`
- Glow: `0 0 0 1px rgba(124,92,255,.45), 0 10px 34px rgba(124,92,255,.20)`
- Shadows: `0 10px 30px rgba(0,0,0,.45)`, `0 24px 64px rgba(0,0,0,.6)`
- Radius: `12px` / `8px` / `16px`; ease `cubic-bezier(.2,.8,.2,1)`
- Display font: **Archivo 800** — `assets/fonts/archivo-800.woff2` (self-hosted, already copied)
- Body font: **Plex** (IBM Plex Sans, variable 100–700) — `assets/fonts/plex-sans.woff2`
- Visual references from the project:
  - `assets/img/icon.svg` — the real app icon (violet gradient rounded square, spreadsheet+plus)
  - `assets/img/galaxy.jpg` — the real Galaxy view, genuinely dark-theme, usable full-frame
  - `assets/img/cover-*.jpg` (10 tiles) — real cover-wall tiles cropped from `docs/shots/games.jpg`,
    each with the app's own burnt-in title/platform caption. Use them as the cover wall.
  - `assets/img/rec-oblivion.jpg` / `rec-seiken.jpg` / `rec-skyrim.jpg` — real recommendation cards
    cropped from `docs/shots/home.jpg`, each with the app's own caption and `~NN% predicted` chip.
  - **Important:** the cropped tiles come from light-theme screenshots, but a cover tile is
    artwork — it carries no theme. Only the tile interiors were cropped, so they sit correctly on
    `#0a0c11`. Do not use `games.jpg` / `home.jpg` / `drawer.jpg` whole; they are light-theme.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **"It's a spreadsheet."** — 3.0s — a plain `#232a37`-gridline spreadsheet with header
   `Title · Platform · Release Date · Completed · Rating` and four real titles; the line in
   Archivo 800, held. Nothing moves. No SFX.
2. **The collection** — 4.0s — the cells become the real cover wall (5 across); **Gamedex**
   wordmark + real icon land; counter runs `1 → 14,387` and settles on `14,387 games`;
   `data as of Aug 25, 2026` small and muted. Violet glow breathes behind the grid.
3. **It filters itself** — 4.0s — the facet sidebar slides in; `PLATFORM` header; three real rows
   arrive one by one (`PC 5,279`, `Nintendo Switch 948`, `SNES 449`); a simulated checkbox tick on
   `PC` reflows the grid behind; under it
   `165 platforms · 288 pages · all of it filtered in your browser.`
4. **It recommends things you don't own** — 4.5s — header `You'd probably love`; the three real
   recommendation cards arrive one by one; the reason chip `Because you liked Yakuza 0` fades in on
   a later beat; then the claim lands big: `369,802 in the catalogue. 14,387 are yours.`
5. **Galaxy, and the sign-off** — 5.5s — the real galaxy blooms out of black with a slow push-in;
   `3,000 stars · 9,313 links · coloured by franchise` counts up over the shot's own real franchise
   legend (`Mario 58`, `Dungeons & Dragons 51`, `Final Fantasy 45` and nine more — the crop keeps it
   rather than recreating it); star brightness breathes with the music; then the galaxy dims and **Gamedex** /
   **Still just a spreadsheet.** / `games.diemer.codes` lands in near-silence.

## Audio
- Audio role: warm bed with sparse, motion-matched accents
- Audio arc: nearly bare under the hook → opens on the cover wall → mechanical ticks through the
  facets → peaks on the recommendation claim and the galaxy bloom → fades out entirely so the final
  line reads in quiet.
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM)
- Music treatment: start at 0 at ~0.35 volume under the hook, open to full on the cover-wall
  reveal, hold through the middle, fade out over the last ~1.5s so the final SFX/silence rings.
- Music cue guidance: preset at
  `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json`.
  - **Strong-cue locks (3 only):** `3.70s` cover-wall + wordmark reveal, `8.96s` first
    recommendation card / claim landing, `12.65s` galaxy bloom. Mark each `// beat-locked`.
  - **Beat grid (0.52s spacing), snap sequential events within ±0.10s, marked `// beat-grid`:**
    facet rows on every *other* beat — `5.80 / 6.86 / 7.91` (they are readable text, so do not use
    consecutive beats); recommendation cards — `8.96 / 10.01 / 11.06`.
  - Ignore any cue that hurts readability or scene pacing; natural timing wins.
- Audio-reactive treatment: **subtle**. Drive only (a) the violet glow intensity behind the cover
  wall in scene 2 and (b) star brightness / a slight scale breath on the galaxy in scene 5, from
  music RMS/bass. Nothing else. No waveform bars, no equalizers, no particles, no strobing.
- Audio-coupled moments:
  - Scene 2 `1 → 14,387` count-up — counter ticks; one dry accent as the wordmark lands
  - Scene 3 three facet rows — a soft interface tick per row, firmer tick on the checkbox
  - Scene 4 three recommendation cards — a card-place sound per card, landing with the motion
  - Scene 5 galaxy bloom — one short announcement cue; counters tick; then nothing under the outro
- SFX selection guidance: sound follows the implemented animation, not this list. Interface/UI
  clicks for facet rows and the checkbox, casino card-place for the card arrivals, one restrained
  impact for the galaxy bloom. Never more than one sound per beat. Nothing bright or metallic —
  the app's design language is muted violet-on-near-black.
- SFX analysis guidance: `~/.claude/skills/brag/assets/sfx/sfx-analysis.md` (+ `.json`). Prefer
  low high-frequency-risk files, especially for the three repeated card and facet-row hits.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density and volume after the visual
  animation exists.
- Audio files: music is already at `brag-output/composition/assets/music/`; copy any selected SFX
  into `brag-output/composition/assets/sfx/`.
- Restraint rule: **no SFX during scene 1.** The anticlimax has to be quiet.

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract
+ `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats,
audio-reactive), `hyperframes-keyframes` (seek-safe keyframes, the scene-5 push-in), and
`hyperframes-cli` (lint/check/render). /brag is its own workflow: do not enter the `hyperframes`
entry-point intent interview and do not route into its generic promo / launch-video workflow.
Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project. (Here: the real cover
  tiles, the real recommendation cards with their own predicted-score chips, the real galaxy view,
  the real facet counts, the real fonts and the real colour tokens.)
- Keep all text readable: short label ~0.8s settled, a sentence ~0.3s/word, min ~1.2s. Fast-in then
  hold — never fast-in then gone. The facet rows and the three cards must each clear that floor,
  which is why they sit on every-other-beat rather than consecutive beats.
- Keep the video within 15–25 seconds (target 21s).
- Include the planned music and SFX layer.
- Treat the `/brag` audio notes as guidance; choose SFX after the animation exists.
- Use only 3 strong-cue locks; snap sequential events to the beat grid.
- Honour the music fade-out under the final wordmark.
- Wire at least one visual element to extracted audio data (the two subtle targets above). If
  extraction is unavailable, note it here and render anyway — do not block.
- Use local assets only (fonts, music, images are all in `composition/assets/`). No CDN webfonts:
  the project self-hosts its fonts on purpose and so must the video.
- Run `hyperframes check` before render — it is brag's single gate.

## Environment notes for the render (this pod)
This machine is rootless with no system ffmpeg or Chrome, so the render needs the shim env:
`source /home/node/.cache/brag-tools/env.sh` before any `hyperframes` command. It puts npm-provided
`ffmpeg`/`ffprobe` on `PATH`, points `LD_LIBRARY_PATH` at the unpacked Chromium shared libs, sets
`HYPERFRAMES_EXTRACT_CACHE_DIR` off the 512 MB `/tmp` tmpfs, and passes
`--disable-dev-shm-usage` because `/dev/shm` is only 64 MB.
