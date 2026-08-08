# Openable boxes: cartridges, discs, and manuals

**Status:** the dev key landed (2026-08-07) and the **box art** half is built — see
*§7 What shipped* at the end. Cartridge/disc scans and ScreenScraper manuals are not wired up
yet, but the resolver already collects their media refs, so what's left for those is wiring
rather than discovery. Everything below is the original investigation, kept because it is still
the map.

**The idea.** A box on the Shelf can be *opened*. The media comes out — a real cartridge or a
real disc, modelled to look like its actual counterpart — and the manual is there too, readable.

---

## 1. What the sources actually give us (all probed, not assumed)

### Manuals — Archive.org ✅ FREE, NO AUTH

The `gamemanuals` collection holds **7,552 items**. Targeted searches hit real scans:

| Query | Result |
|---|---|
| Chrono Trigger | `chrono-trigger-usa` |
| Mega Man 2 | `mega-man-2-nes-manual` |
| Sonic the Hedgehog | `sonic-2-pdf`, `sonic-cd-jp-manual` |
| Super Mario World | `manual-pt-supermarioworld-snes` |

Search endpoint (works unauthenticated):

```
https://archive.org/advancedsearch.php
  ?q=mediatype:texts AND title:("<TITLE>") AND (manual OR instruction)
  &fl[]=identifier&fl[]=title&rows=5&output=json
```

Then `https://archive.org/metadata/<identifier>` lists the files (PDF / JP2 / page images), and
`https://archive.org/download/<identifier>/<file>` serves them.

**Watch out:** a plain keyword search is very noisy — "Super Mario World manual" returned a Voice
of America broadcast as its top hit. It *must* be constrained with `mediatype:texts` and a title
match, and even then results want validating (platform in the title, year, publisher) before we
attach one to a game. Reuse `MatchValidator` the way the other sources do.

### Disc faces — GameTDB ✅ FREE, NO AUTH

Real disc art, verified live:

| URL | Result |
|---|---|
| `art.gametdb.com/wii/disc/US/RMGE01.png` | 200, 61,629 b |
| `art.gametdb.com/wii/disc/US/GALE01.png` (GameCube) | 200, 48,480 b |
| `art.gametdb.com/wii/coverfullHQ/US/RMGE01.png` | 200, 1,126,253 b |
| `art.gametdb.com/3ds/box/US/AREE.png` | 200, 90,757 b |
| `art.gametdb.com/switch/box/US/<titleid>.png` | 404 — Switch needs the real title id, not a guess |

Covers **GameCube, Wii, Wii U, DS, 3DS, PS3** (and Switch boxes, given a correct title id).

Keyed on the platform's own game id (`RMGE01`), which we do **not** have. GameTDB publishes full
database dumps that map id ↔ title — all returned `200`:

- `https://www.gametdb.com/wiitdb.zip?LANG=EN`
- `https://www.gametdb.com/PS3TDB.zip?LANG=EN`
- `https://www.gametdb.com/SwitchTDB.zip?LANG=EN`

So the join is: our title → GameTDB dump → game id → art URL. Cache the dumps on the PVC and
refresh occasionally; they're small and static.

**RomM may already know the id.** Its ROM records carry file names and often the serial. Worth
checking before building a title matcher — a serial is an exact join and a title is a guess.

### Cartridge labels — ScreenScraper ⚠️ BLOCKED ON CREDENTIALS

**libretro-thumbnails is NOT a source for this.** Confirmed: it carries only `Named_Boxarts`,
`Named_Logos`, `Named_Snaps`, `Named_Titles`. No cartridge or disc scans. Don't go back to it.

ScreenScraper is the real bulk source for physical-media scans (it calls them *support* images:
cart labels, disc faces, floppies) **and** it carries manuals too. It needs **two** credential
pairs, and it checks the developer one first — every endpoint refuses without it:

```
$ curl 'https://api.screenscraper.fr/api2/jeuInfos.php?output=json&romnom=Chrono%20Trigger.sfc&systemeid=4'
Erreur de login : Vérifier vos identifiants développeur !

$ curl 'https://api.screenscraper.fr/api2/systemesListe.php?output=json'
Erreur de login : Verifier vos identifiants developpeur !
```

| Credential | What it is | Status |
|---|---|---|
| `devid` / `devpassword` | a **developer key**, issued per piece of software, on request via their forum | **we do not have this** |
| `ssid` / `sspassword` | the **user account** — raises quota, unlocks higher-res media | Zach has one |

A user account alone is not enough. The dev key is free but a human grants it, so it takes a
day or two.

**When we have them**, they go in `games/gamedex/values.local.yaml` (gitignored, same as the IGDB
and RomM secrets — never in chat, never in git):

```yaml
screenscraper:
  devId: "..."
  devPassword: "..."
  user: "..."
  password: "..."
```

…then through `templates/secret.yaml` → `deployment.yaml` env → `src/screenscraper.py`, exactly
like `igdb.py` and `romm.py` do it.

API shape once authenticated: `api2/jeuInfos.php?devid=&devpassword=&softname=gamedex&ssid=&sspassword=&output=json&systemeid=<n>&romnom=<name>`
returns a `jeu` object whose `medias[]` array carries typed entries — the ones we want are the
**support** media (the cartridge/disc scan) and **manuel** (the manual). Note it is rate-limited
per account and returns a quota in every response; be a good citizen and cache hard, one lookup
per game forever, like `enrich.py` already does.

---

## 2. The art plan: three tiers, so nothing is ever a blank shell

1. **Derived from the box art** (default, zero dependencies, works for all 14,746 games).
   Crop the cover onto a platform-correct label template. This looks convincing because a real
   cart label usually *is* a crop of the cover art. Every game gets something on day one.
2. **Real scans from ScreenScraper** (when the dev key lands). Genuine cart labels and disc faces
   for essentially the whole retro library. This is the tier that actually satisfies "it must look
   like its real counterpart."
3. **Hand-uploaded** — point the existing cropping uploader (`openCoverEditor`, `shelf.py
   set_cover`) at the cart/disc face too. Same machinery, new `kind`.

Disc faces additionally come from GameTDB where it knows the game (see above), which is likely
*better* than ScreenScraper for GameCube/Wii/PS3.

**Honest caveat, worth restating to Zach:** the geometry can be genuinely right. The label art is
only *truly* real via ScreenScraper or his own uploads. The derived fallback will look good, but a
purist knows a Chrono Trigger cart label isn't a crop of the Chrono Trigger box.

---

## 3. The models

The Shelf is already CSS 3D with textured faces (`static/shelf.js`, `.sh-stage`, `preserve-3d`,
one 3D case at a time). A cartridge is the same machinery with a different silhouette, so this
needs no new rendering approach — but each shell has to be *specifically* shaped or it's just a
grey slab:

- **NES** — chunky slab, deep front bezel, label recessed
- **SNES** — curved shoulders, ridged grip, the distinctive tapered top
- **N64** — tall shell, finger grooves, label high on the face
- **Game Boy / GBC** — small, notched corner (the anti-insert cut)
- **GBA** — stubby, rounded, label nearly the whole face
- **DS / 3DS / Switch** — flat cards, tiny; Switch has the distinctive notch
- **Genesis / Mega Drive** — tall, angled, ridged
- **Optical** — a real clear hub ring, a data-side rainbow sheen (a conic-gradient does this well),
  and the **GameCube mini-disc** is a smaller diameter, which people notice
- **Manual** — a booklet with visible page edges and a slight fan

Platform brand colours for the shells are already in `SPINE_LOGOS` / `spineStyle()` in `shelf.js`
— reuse them rather than inventing a second table.

### The opening interaction — OPEN QUESTION, ask Zach

Two physically honest behaviours, and they're not the same:

- **Hinged case** (optical discs, DS/Switch/modern carts): the case opens like a real case, the
  disc seated on its hub in one half, the manual in the lid.
- **Slide-out** (classic cartridges): a cart never lived in a hinged case — it comes *out of* the
  box and you hold it up.

My instinct is to do both, chosen by platform. Zach hasn't ruled on whether he'd rather it be
uniform. **Ask before building.**

---

## 4. Where this plugs in

- `src/screenscraper.py` — new source client. Model it on `src/keitai.py` (rate limiter,
  `serves(platform)` gate, `match(game)` returning a record with `confidence`, and
  `override_from_url()` so a wrong match can be fixed by hand from the drawer's mapping control).
- `src/manuals.py` — Archive.org client. Same shape. Gate it on retro platforms; there's no point
  asking about a 2024 PC game.
- `src/gametdb.py` — dump-backed id lookup + disc art URLs. Cache the dumps on the PVC.
- `src/enrich.py` — register both as sources; add their light fields to `_IGDB_LIGHT` /
  `_FACET_LIGHT` (`cartArt`, `discArt`, `manualUrl`, `manualPages`) and add a `backfill_media()`
  in the shape of `backfill_extras()` — **and remember what that one taught us: chunk it, retry
  with backoff, and commit each chunk as it lands.** A 429 four seconds in threw away the whole
  first pass.
- `static/shelf.js` — the models, the open/close animation, and a media face on the 3D case.
- New `static/manual.js` — the page-turning reader.

---

## 5. Facts about the library, for scoping

Measured 2026-07-13:

| | |
|---|---|
| Games total / owned | 14,746 / 7,570 |
| No box art at all | 283 |
| No metadata match at all | 188 |
| Owned on RetroAchievements-class platforms | 428 |
| Owned GameCube/Wii/Wii U/DS/3DS (GameTDB disc art territory) | ~1,326 modern Nintendo + retro |

---

## 6. Next actions

1. **Zach:** request `devid`/`devpassword` from ScreenScraper (their forum), then put all four
   credentials in `values.local.yaml`. Their site was down on 2026-07-13 — retry.
2. **Zach:** decide hinged-case vs slide-out vs both (§3).
3. **Claude:** the parts that need nothing from anyone, and can start any time —
   - the manual reader on Archive.org (nothing else in the app gives you this)
   - GameTDB disc art (check RomM for serials first, it may make the join exact)
   - the cartridge/disc geometry and the open animation
   - derived cart labels from box art
4. **Claude:** when the dev key lands, slot ScreenScraper in *above* the derived labels. Everything
   built before it keeps working — it just gets better art.

---

## 7. What shipped (2026-08-07) — the box art

The dev key arrived, so the tier-2 art in §2 is real for the BOX. Cartridge labels, disc faces
and ScreenScraper manuals are still to come; §7.5 says what's left of them.

### The shape of it

ScreenScraper is unlike Cover Project in the one way that matters: it hands over the faces as
**separate photographs** (`box-2D`, `box-2D-back`, `box-2D-side`) rather than one flattened
wrap. All three of the hard problems `tools/resolve_covers.py` exists to solve — which of seven
regional scans, which print template, which way up — were expected to vanish. Two of them did.

| | |
|---|---|
| `src/screenscraper.py` | the client: auth, quota, rate limit, region selection |
| `tools/resolve_screenscraper.py` | offline matcher → `data/screenscraper.json` (resumable) |
| `src/shelf.py` | the per-face chain, orientation, the fetch cache, the warm crawl |
| `static/shelf.js` | `shHasFaces()` — one predicate, three real-art sources |

### Four things the live API taught us that the docs did not

**1. An exact name beats the picture — and the picture is actively wrong.** The plan was to
prove every hit against the IGDB cover, the way `resolve_covers.py` does. That is correct
*there*, where Cover Project is a folder of community uploads and the scan and the cover are
the same printing of the same box. Here the catalogue is curated and keyed by system id, while
their `box-2D` is frequently a **different regional printing** from the one IGDB holds. So the
fingerprint can rank the right game below the wrong one. Measured, on Yoshi's Island:

```
#2163 "Super Mario World 2 - Yoshi's Island"  -0.0569   <- the right game
#2144 "Super Mario World"                     +0.0505   <- what that design shipped
```

An exact slug match against *any* of their names is now taken on its own, and no image is
fetched. Only a fuzzy match has to argue with the picture. Do not invert this again.

**1b. …and the picture can't be trusted to decide alone either.** The first full crawl proved
the corollary. Of 534 boxes, 30 were picture-decided at the inherited `MIN_SCORE = 0.05`, and
a large share of those were simply wrong:

```
exzeusthecompletecollection    +0.069 -> "Clea Complete Collection"
apexheroinesplatinumedition    +0.137 -> "Dying Light - Platinum Edition"
blasphemous2                   +0.167 -> "Blasphemous Deluxe Edition"
clocktowerrewind               +0.105 -> "COGEN - Sword of Rewind"
```

Every one of those has a name with **no relation** to ours; a weak correlation was the only
thing arguing for it. The picture is now a confirmer, never a decider: a candidate must ALSO
have a name relation (`MAX_FUZZY_RANK = 1` — one name contains the other) and clear a much
higher bar (`MIN_SCORE = 0.20`). This costs a handful of genuinely-right matches (Atari 50's
"Celebration Expanded" vs their "Anniversary Collection" no longer connects) and that is the
correct trade: those games keep a correct IGDB cover, which beats a real box belonging to a
different game.

**2. A colon breaks their search.** `"The Legend of Zelda: A Link to the Past"` returns one
result object with **no fields** — not an error, not an empty array. Drop the colon and it
matches immediately. So the resolver walks a ladder of terms (full → depunctuated → head →
subtitle), pools everything, and short-circuits only on an exact name. The subtitle rung earns
its place too: "Final Fantasy Mystic Quest" finds nothing, "Mystic Quest" finds it (they file
it as *Mystic Quest Legend*). Their regional renames are wild — Star Fox is **Starwing**.

**3. One region for the whole box.** Ocarina of Time carries **nine** regional printings of
each face. Choosing the best available per face is the obvious implementation and it assembles
a box that never existed: a US front, a European spine, an Australian back. The region is now
chosen once, from the printings that have a front, and every other face comes from that same
printing — falling back only when it genuinely lacks one. `regionMatch` records whether you got
the printing you own, and the shelf card says so rather than implying it.

Two follow-on bugs, both found by *reading the resolved data* rather than trusting it — 88 of
214 boxes were flagged foreign, which was far too many to be true:

- `REGION_PREF` was missing `Asia` (64 owned games) and `Korea` (3), so they fell through to
  the **US-first** order — exactly the substitution the per-region box key exists to prevent.
  A region missing from that table is not a harmless gap.
- A **worldwide** (`wor`) printing was being called foreign. A region-free Switch card has one
  printing and it is yours; see `UNIVERSAL_REGIONS`.

`region_matches()` is deliberately a free function of (chosen region, owned region), so a
stored manifest can be re-judged without re-fetching a single image. That turned what would
have been a full re-crawl into an in-place pass.

**4. "Which way is up" did not vanish — it moved to the spine.** On a landscape-box platform
(SNES, N64) the spine arrives as a wide horizontal strip, 400×57, because that is how it lies
on the flattened box. The 3D case's left wall is 33mm × 133mm. Painted as-is it is a smear.
`_orient()` fixes it with geometry, not a heuristic: the face's true aspect is known from the
case dimensions, so it turns the image only when that measurably fits better (log-ratio, so
"twice as wide" and "half as wide" are the same size of wrong). Genesis and PlayStation spines
are correctly left alone.

### Faces resolve one at a time, across sources

`Shelf.face()` is a chain, not a tier:

1. the owner's upload
2. a ScreenScraper photograph of that face
3. the Cover Project wrap's panel, or a slice of ScreenScraper's own `box-texture`
4. a face synthesised from the front (hue spine, blurred back)

3 above 4 is the point. The common ScreenScraper game has a front and nothing else — and if
Cover Project scanned that game's wrap, it has a *real* spine, which beats a coloured
rectangle. So a box can wear a ScreenScraper front and a Cover Project spine, and the browser
never learns this: it asks `/api/shelf/face` and the server decides.

### Coverage, and why it is what it is

ScreenScraper is a **retro** database. Spot-checked against the collection: it *has* the modern
games (Sifu, Helldivers II, Yakuza Kiwami 2 all match by exact name) but holds **no box art**
for them, so the resolver declines and they keep their Cover Project wrap or IGDB cover. The
value lands on the retro shelf, which is exactly where the fabricated boxes were.

### The thing that nearly bit

The shelf paints a spine for **every** game with real art, so the first person to scroll would
otherwise trigger thousands of cold, rate-limited fetches, each parked in a request thread —
the app stops answering long before the quota does. Two guards: a boot-time warm crawl (serial,
resumable via `.done` stamps, stops when the quota does) and a **two-concurrent** cap on
on-demand fetches. Measured: 12 simultaneous requests return in 0.7s serving 2, rather than
parking 12 threads for 7s. A face you can't have yet is a spine in the right colour.

### 7.5 Still to do

- **Cartridge and disc scans** (`support-2D`). The manifest already stores the ref per game, so
  no new matching or quota is needed; `static/media.js` has held `mediaArt().scan` open for
  this since July. Needs a serving route and the label warped onto the pre-rendered shells.
- **Manuals** (`manuel`, a real PDF on `mediaManuelJeu.php`). Stored per game already. A second
  source behind the Archive.org reader, useful where Archive has no scan.
- **Re-run the resolver** when the collection grows; it resumes and only asks about what's new.
