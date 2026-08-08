#!/usr/bin/env python3
"""Decide, once, which ScreenScraper game each shelf box is — and prove it.

This is resolve_covers.py's sibling, and the difference between them is the whole
point of adding ScreenScraper at all. Cover Project gives us a flattened WRAP, so
that resolver spends its effort on which scan, which template, and which way up.
ScreenScraper gives us the faces as separate photographs, so none of those questions
exist here. What's left is the one question they share: IS THIS THE RIGHT GAME?

Two kinds of evidence answer it, and which one leads is the thing this tool learned
the hard way.

An EXACT name match, on a database keyed by system id, is the answer on its own.
Their catalogue is curated — not a folder of community uploads — so "Chrono Trigger"
on system 4 is Chrono Trigger on the SNES. Nothing more is asked, and no image is
fetched to confirm it.

Anything short of exact has to be argued for with the PICTURE: score their box front
against the IGDB cover we already hold (the same fingerprint test resolve_covers.py
uses, for the same reason). That catches "Aladdin" on Mega Drive being two different
games, and their database carrying this game's ROM hacks beside it.

Do NOT promote the picture test above the name. It was tried, and it is actively
wrong here — see the measurement in resolve(). ScreenScraper's `box-2D` is often a
different regional printing from the one IGDB happens to hold, so the right game can
score BELOW the wrong one. That is a hazard resolve_covers.py does not have, because
there the scan and the cover are the same printing of the same box.

What lands in data/screenscraper.json is deliberately thin: which media each game has,
not the media itself. Two reasons. Their media URLs carry our developer key and account
password in the query string and this file is committed, so keeping the URLs would
commit the credentials. And the images are the expensive part — several hundred MB —
which belongs on the PVC where the server caches it, not in the repo.

Usage:
    python3 tools/resolve_screenscraper.py --systems         # check SYSTEME_ID first
    python3 tools/resolve_screenscraper.py --api https://games.zachd.duckdns.org
"""

from __future__ import annotations

import argparse
import collections
import io
import json
import os
import pathlib
import re
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from coverproject_index import slugify                                    # noqa: E402
from resolve_covers import IGDB_IMG, fingerprint, get, row_key, similarity  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "src"))
from screenscraper import (SYSTEME_ID, QuotaExceeded, ScreenScraper,      # noqa: E402
                           art_for)
from shelf import DEFAULT_CASE, FALLBACK_CASE                             # noqa: E402

# How much the candidate's box front has to look like the IGDB cover before a
# NON-exact name is believed.
#
# resolve_covers.py uses 0.05 and is right to: there the scan and the cover are the
# same printing of the same box, so a positive correlation means something. Here they
# are routinely different regional printings, so the signal is much weaker — and a
# weak signal with a low floor let all of these onto the shelf at 0.05:
#
#     exzeusthecompletecollection    +0.069 -> "Clea Complete Collection"
#     apexheroinesplatinumedition    +0.137 -> "Dying Light - Platinum Edition"
#     blasphemous2                   +0.167 -> "Blasphemous Deluxe Edition"
#     clocktowerrewind               +0.105 -> "COGEN - Sword of Rewind"
#
# So the picture no longer DECIDES anything on its own. It only confirms a candidate
# whose name already resembles ours, and it has to do so convincingly.
MIN_SCORE = 0.20

# The worst name relation the picture is allowed to rescue: 1 is "one name contains
# the other" (Cotton Fantasy inside Cotton Fantasy Superlative Night Dreams). 2 is
# "no relation at all", and every wrong match above was a 2 — no amount of picture
# evidence should talk us into a box whose name has nothing to do with the game.
MAX_FUZZY_RANK = 1

def _titles(jeu: dict) -> list[str]:
    """Every name they hold for this game — regional variants and all."""
    noms = jeu.get("noms") or []
    if isinstance(noms, dict):                     # some responses key by region
        noms = list(noms.values())
    out = []
    for n in noms:
        t = n.get("text") if isinstance(n, dict) else n
        if t:
            out.append(str(t))
    return out


def _terms(title: str) -> list[str]:
    """The search terms to try, in order, until one of them finds something.

    Their search does NOT like a full punctuated title. Every one of these comes back
    with a single empty result — not an error, not a miss, an object with no fields:

        "The Legend of Zelda: A Link to the Past"    0 named hits
        "Super Mario World 2: Yoshi's Island"        0 named hits
        "Donkey Kong Country 2: Diddy's Kong Quest"  0 named hits

    Drop the colon and all three match on the first try. Their own names for those
    games are "Legend Of Zelda - A Link To The Past The" and "Super Mario World 2 -
    Yoshi's Island", so the colon is the thing their index doesn't have.

    The subtitle alone is the last resort and earns its place: "Final Fantasy Mystic
    Quest" finds nothing (they file it as "Mystic Quest Legend"), while "Mystic Quest"
    finds it immediately. Each rung is one more search request against a 100k/day
    quota — cheap insurance against silently skipping a game we own."""
    t = (title or "").strip()
    out = [t]
    if ":" in t or "-" in t:
        out.append(re.sub(r"\s+", " ", t.replace(":", " ").replace("-", " ")).strip())
        head, _, tail = t.partition(":")
        out.append(head.strip())
        if tail.strip():
            out.append(tail.strip())
    seen, uniq = set(), []
    for s in out:
        if s and s.lower() not in seen:
            seen.add(s.lower())
            uniq.append(s)
    return uniq


def search_best(client: ScreenScraper, sid: int, title: str) -> list[dict]:
    """Their search, down the ladder, keeping everything it finds.

    Stopping at the first rung that returns ANYTHING is not good enough, and Yoshi's
    Island is why: "Super Mario World 2" is a perfectly successful search that returns
    plain Super Mario World and not the game we asked about, so the run ended one rung
    above the one that would have found it. Now it keeps going and pools the results —
    and only short-circuits on an EXACT name match, which is the one case where more
    searching cannot improve on what we have.

    A "hit" with no `noms` is their way of saying nothing was found: the array holds a
    single object with no fields at all rather than being empty. Those are dropped
    before anything downstream counts them."""
    seen, pool = set(), []
    for term in _terms(title):
        for j in client.search(sid, term):
            if not j.get("noms") or j.get("id") in seen:
                continue
            seen.add(j.get("id"))
            pool.append(j)
        if any(_name_rank(title, j) == 0 for j in pool):
            break
    return pool


def _name_rank(title: str, jeu: dict) -> int:
    """How well their names match ours: 0 exact, 1 one contains the other, 2 neither.

    Rank 0 DECIDES (see resolve). Ranks 1 and 2 only order the queue, because their own
    ranking is not ours — searching "Super Mario World 2" puts plain Super Mario World
    above Yoshi's Island — and only the top `--candidates` are ever verified.

    Every name they hold for the game is tried, not just the first: this is what
    catches the regional renames, which are wilder than you would expect. Star Fox is
    filed under its PAL name "Starwing", and A Link to the Past under "Legend Of Zelda
    - A Link To The Past The"."""
    want = slugify(title)
    if not want:
        return 2
    best = 2
    for t in _titles(jeu):
        got = slugify(t)
        if want == got:
            return 0
        if len(want) > 6 and (want in got or got in want) and not _sequel_apart(want, got):
            best = min(best, 1)
    return best


def _sequel_apart(a: str, b: str) -> bool:
    """Is the only thing between these two names a SEQUEL NUMBER?

    Containment is the right test for edition names — "NieR Automata" inside "NieR
    Automata Game of the YoRHa Edition" is the same box. It is the wrong test the
    moment the extra part starts with a digit, because that digit is the entire
    difference between two games:

        knack            vs knack2                          -> different games
        fairytail        vs fairytail2                       -> different games
        gearclubunlimited vs gearclubunlimited2ultimateedition -> different games

    All three matched on a decent picture score and shipped the wrong box.

    But not every trailing digit is a sequel, and the naive version of this rule threw
    away two correct boxes proving it:

        carmensandiego + "40thanniversaryedition"   an ORDINAL, not a sequel
        worldseriesofpoker... + "2007"              a YEAR, not a sequel

    So a sequel number is short (one or two digits — there is no Knack 2007) and is not
    an ordinal. Everything else is an edition name, and editions share a box."""
    long, short = (a, b) if len(a) > len(b) else (b, a)
    if not long.startswith(short):
        return False
    tail = long[len(short):]
    digits = ""
    while tail[len(digits):len(digits) + 1].isdigit():
        digits += tail[len(digits)]
    if not digits or len(digits) > 2:
        return False                       # no number at all, or a year
    return not tail[len(digits):].startswith(("th", "st", "nd", "rd"))


def resolve(client: ScreenScraper, game: dict, cover_fp, verify_top: int) -> dict | None:
    """The ScreenScraper game this box is, or nothing.

    Nothing is a perfectly good answer: the game keeps whatever art it has today. A
    WRONG answer puts another game's box on your shelf, which is worse than a plain
    one, so every gate here fails closed.

    `cover_fp` is a CALLABLE returning the IGDB cover's fingerprint, not the
    fingerprint — because most games never need it (an exact name settles them) and
    the ones that do are a minority worth paying a download for. Fetching it up front
    also meant skipping every game IGDB has no cover for, which was exactly backwards:
    a game with no cover is the one showing a blank slab today, and it is precisely
    where a real box is worth the most."""
    sid = SYSTEME_ID.get(game.get("platform") or "")
    if not sid:
        return None
    title = game.get("title") or ""
    if not title:
        return None

    hits = search_best(client, sid, title)
    if not hits:
        return None
    # Best-named first, their own order breaking ties. A name that resembles ours at
    # all still gets a turn (the fingerprint is the real gate, and their regional
    # renames are wild: Star Fox is filed as "Starwing"), it just goes to the back.
    cands = sorted(hits, key=lambda j: _name_rank(title, j))

    region = (game.get("releaseRegion") or "").strip()

    def entry(jeu, art, score):
        mm = FALLBACK_CASE.get(game.get("platform"), DEFAULT_CASE)
        return {"jeuid": str(jeu.get("id") or ""), "systemeid": sid,
                "name": (_titles(jeu) or [title])[0],
                "score": None if score is None else round(score, 4),
                "by": "name" if score is None else "cover",
                # The faces are separate photographs, so they say nothing about the
                # box's shape. It comes from the platform's real case dimensions,
                # which is the better source anyway.
                "case": {"w": mm[0], "h": mm[1], "d": mm[2]}, **art}

    # AN EXACT NAME IS THE ANSWER. Not a hint to be confirmed by the picture — the
    # answer. This is the one place this resolver must NOT copy resolve_covers.py.
    #
    # There, the fingerprint does the heavy lifting because Cover Project is a folder
    # of community uploads: fan covers filed under the real game's slug, seven regional
    # scans, nothing but the pixels to tell them apart. Here the source is a curated
    # database keyed by system id, and their `box-2D` is frequently a DIFFERENT
    # regional printing from the one IGDB happens to hold — so the picture test does
    # not merely add nothing, it gets the answer backwards. Measured, on Yoshi's Island:
    #
    #     #2163 "Super Mario World 2 - Yoshi's Island"  -0.0569   <- the right game
    #     #2144 "Super Mario World"                     +0.0505   <- what we shipped
    #
    # The wrong box cleared the floor and the right one didn't. So an exact slug match
    # on any of their names for the game is taken on its own, and the fetch is skipped
    # entirely — which is also one fewer media request per game against the quota.
    for jeu in cands:
        if _name_rank(title, jeu) != 0:
            break                          # sorted: no exact matches left to find
        art = art_for(client, jeu, region)
        if (art.get("faces") or {}).get("front") or art.get("texture"):
            return entry(jeu, art, None)

    # No exact name. Now the picture has to argue for it, because all we have is a
    # fuzzy string match against a database that contains this game's ROM hacks.
    # Sorted by rank, so if the FIRST is already too far off, none of them are close
    # enough for a picture to rescue — and the IGDB cover download is pure waste.
    cands = [j for j in cands[:verify_top] if _name_rank(title, j) <= MAX_FUZZY_RANK]
    if not cands:
        return None
    fp = cover_fp()
    if fp is None:
        return None                        # nothing to check against: refuse rather than guess
    best = None
    for jeu in cands:
        art = art_for(client, jeu, region)
        front = (art.get("faces") or {}).get("front")
        if not front:
            continue                       # no box front: nothing to show and nothing to check
        # Fetched at 200px: a fingerprint is 28x36 and their scans are several MB.
        raw = client.fetch(front, max_px=200)
        if not raw:
            continue
        try:
            score = similarity(fingerprint(Image.open(io.BytesIO(raw))), fp)
        except Exception:
            continue
        if best is None or score > best["score"]:
            best = entry(jeu, art, score)

    if not best or best["score"] < MIN_SCORE:
        return None
    return best


def dump_systems(client: ScreenScraper) -> int:
    """Print their system list beside ours, so SYSTEME_ID is checked rather than
    trusted. Run this first: a wrong id doesn't error, it just quietly searches the
    wrong console and finds nothing (or, worse, something)."""
    systems = client.systems()
    if not systems:
        print("no system list — check the developer credentials", file=sys.stderr)
        return 1
    names = {}
    for s in systems:
        sid = s.get("id")
        noms = s.get("noms") or {}
        label = noms.get("nom_eu") or noms.get("nom_us") or noms.get("noms_commun") or ""
        names[str(sid)] = label
        print(f"{sid:>5}  {label}")
    print("\n--- our mapping, checked ---", file=sys.stderr)
    for plat, sid in sorted(SYSTEME_ID.items()):
        got = names.get(str(sid))
        flag = "  " if got else "??"
        print(f"{flag} {plat:<40} -> {sid} {got or 'NOT IN THEIR LIST'}", file=sys.stderr)
    return 0


def probe(client: ScreenScraper, platform: str, title: str) -> int:
    """Show one game's search hits and every media on them, raw.

    This exists because the rest of this tool rests on an assumption that costs a lot
    to get wrong: that `jeuRecherche.php` returns games with their `medias[]` attached,
    so one call per game is enough. If it comes back without them, every candidate
    needs a second `jeuInfos.php` call and the quota arithmetic doubles. Look, don't
    assume."""
    sid = SYSTEME_ID.get(platform)
    if not sid:
        print(f"no system id for {platform!r}. Known: {', '.join(sorted(SYSTEME_ID))}",
              file=sys.stderr)
        return 2
    hits = search_best(client, sid, title)
    print(f"{len(hits)} hit(s) on system {sid} for {title!r}\n")
    for jeu in hits[:5]:
        medias = jeu.get("medias") or []
        print(f"  #{jeu.get('id')}  {' / '.join(_titles(jeu)[:3])}")
        if not medias:
            print("    NO medias[] on the search result — jeuInfos is needed per candidate")
        for m in medias:
            print(f"    {m.get('type', '?'):<18} {m.get('region', ''):<5} "
                  f"{m.get('format', ''):<5} {(m.get('url') or '')[:60]}...")
        print()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://games.zachd.duckdns.org")
    ap.add_argument("--out", default="data/screenscraper.json")
    ap.add_argument("--systems", action="store_true",
                    help="print their system list and check SYSTEME_ID against it")
    ap.add_argument("--candidates", type=int, default=2,
                    help="how many search hits to verify against the IGDB cover. Each "
                         "one costs a media request, so this is the main quota dial.")
    ap.add_argument("--limit", type=int, default=0, help="stop after N games (a dry run)")
    ap.add_argument("--platform", default="", help="only this platform")
    ap.add_argument("--probe", default="",
                    help="dump the raw media list for one title (needs --platform). Run this "
                         "first on a known game: it is the only way to SEE what their search "
                         "actually returns, rather than trusting that it matches the docs.")
    a = ap.parse_args()

    client = ScreenScraper()
    if not client.enabled:
        print("no developer key. Set SCREENSCRAPER_DEV_ID / SCREENSCRAPER_DEV_PASSWORD "
              "(and ideally SCREENSCRAPER_USER / SCREENSCRAPER_PASSWORD) — every endpoint "
              "refuses without the developer pair.", file=sys.stderr)
        return 2
    if a.systems:
        return dump_systems(client)
    if a.probe:
        return probe(client, a.platform, a.probe)

    who = client.quota()
    if who:
        print(f"account {who.get('id', '?')}: {who.get('requeststoday', '?')}/"
              f"{who.get('maxrequestsperday', '?')} requests today, "
              f"{who.get('maxthreads', '?')} thread(s)", file=sys.stderr)

    print("loading the collection ...", file=sys.stderr)
    rows = json.loads(get(f"{a.api}/api/data", 300))["sheets"]["games"]["rows"]
    enr = json.loads(get(f"{a.api}/api/enrichment/all", 300))["items"]

    phys = [r for r in rows if r.get("owned")
            and (r.get("format") or "").strip().lower() in ("physical", "both")]
    if a.platform:
        phys = [r for r in phys if r.get("platform") == a.platform]
    if a.limit:
        phys = phys[:a.limit]

    unmapped = collections.Counter(r.get("platform") for r in phys
                                   if r.get("platform") not in SYSTEME_ID)
    print(f"  {len(phys)} physical games owned; "
          f"{sum(unmapped.values())} on platforms ScreenScraper isn't asked about",
          file=sys.stderr)

    # Resume: an interrupted run (or a spent quota) keeps everything it resolved, so
    # tomorrow's run only asks about what's still missing. This crawl is measured in
    # hours against a daily ceiling; making it restartable is not optional.
    out_path = pathlib.Path(a.out)
    games = {}
    if out_path.exists():
        try:
            games = json.loads(out_path.read_text()).get("games", {})
            print(f"  resuming: {len(games)} already resolved", file=sys.stderr)
        except Exception:
            pass

    def save():
        out_path.write_text(json.dumps({"games": games}, separators=(",", ":")))

    # Strictly serial. A non-contributing account gets one thread, and being greedy
    # with someone's free API is how the key gets taken away.
    done = stopped = 0
    for i, r in enumerate(phys):
        key = row_key(r)
        if key in games:
            continue
        # The IGDB cover, fetched ONLY if an exact name doesn't settle it. Memoised
        # per game so the fuzzy path doesn't download it once per candidate.
        e = enr.get(r["_k"]) or {}
        box: list = []

        def cover_fp(e=e, box=box):
            if box:
                return box[0]
            fp = None
            if e.get("cover"):
                raw = get(IGDB_IMG.format(e["cover"]), 45)
                if raw:
                    try:
                        fp = fingerprint(Image.open(io.BytesIO(raw)))
                    except Exception:
                        fp = None
            box.append(fp)
            return fp

        try:
            hit = resolve(client, r, cover_fp, a.candidates)
        except QuotaExceeded as ex:
            print(f"\nquota spent ({ex}) — saving {len(games)} and stopping. "
                  f"Re-run tomorrow; it resumes.", file=sys.stderr)
            stopped = 1
            break
        if hit:
            games[key] = hit
            done += 1
        if i % 25 == 0:
            save()
            print(f"  {i}/{len(phys)} · {len(games)} boxes", file=sys.stderr)

    save()
    faces = collections.Counter()
    for v in games.values():
        for f in (v.get("faces") or {}):
            faces[f] += 1
        for extra in ("texture", "support", "manual"):
            if v.get(extra):
                faces[extra] += 1
    by = collections.Counter(v.get("by") for v in games.values())
    print(f"\nwrote {out_path}: {len(games)} boxes ({done} new this run) — "
          f"{by.get('name', 0)} matched on an exact name, {by.get('cover', 0)} on the cover",
          file=sys.stderr)
    print(f"  faces: " + ", ".join(f"{k} {n}" for k, n in sorted(faces.items())),
          file=sys.stderr)
    if unmapped:
        print("  no ScreenScraper system id for: "
              + ", ".join(f"{p} ({n})" for p, n in unmapped.most_common(12)),
              file=sys.stderr)
    return stopped


if __name__ == "__main__":
    sys.exit(main())
