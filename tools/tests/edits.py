#!/usr/bin/env python3
"""Self-check for the staged-edits overlay (src/edits.py).

The overlay's writing is boring; its RETIREMENT is not, and it's the part that
goes wrong silently — a stale overlay shadows the spreadsheet forever, including
over later edits made in Excel. So this exercises the four outcomes of a fresh
parse (apply, retire, conflict, orphan), the added-row lifecycle, and the one
asymmetry that is easy to break: the write-through pass must NOT judge, because
the rows it looks at already carry the overlay.

Run:  python3 tools/tests/edits.py       (no pytest; nothing else here needs it)

The pod has no pip, so the three dependencies of match_validator and openpyxl are
stubbed below. Only normalize()'s transliteration is faked out — the keys stay
self-consistent, which is all identity needs here.
"""

import os
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "src"))

# ---- stubs for the wheels that aren't installed in this pod -----------------
_stub = lambda name, **attrs: sys.modules.setdefault(name, types.SimpleNamespace(**attrs))
_stub("openpyxl", load_workbook=lambda *a, **k: None)
_stub("unidecode", unidecode=lambda s: s)
_stub("edit_distance", SequenceMatcher=object)
_stub("roman", fromRoman=lambda s: 0, InvalidRomanNumeralError=ValueError)

import edits as edits_mod                                   # noqa: E402
from matchkey import match_key_for                           # noqa: E402

FAILED = []


def check(label, got, want):
    if got != want:
        FAILED.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


def sheet(rows):
    """A minimal parsed dataset — the overlay only ever touches rows."""
    return {
        "games": {"columns": [], "rows": rows},
        "completed": {"columns": [], "rows": []},
        "onOrder": {"columns": [], "rows": []},
    }


def new_store():
    path = os.path.join(tempfile.mkdtemp(), "edits.sqlite")
    return edits_mod.Edits(path)


KEY = match_key_for("Chrono Trigger", "Super Nintendo", 1995)


def row(**kw):
    base = {"title": "Chrono Trigger", "platform": "Super Nintendo", "releaseYear": 1995}
    base.update(kw)
    return base


# ---- 1. a field edit applies, and keeps applying ---------------------------
print("field edit applies")
E = new_store()
data = sheet([row()])
E.stage_field("games", KEY, "playingStatus", "Playing", None)
E.apply(data)
check("value overlaid", data["games"]["rows"][0].get("playingStatus"), "Playing")
check("marked as yours", data["games"]["rows"][0].get("_edited"), ["playingStatus"])
# A second fresh parse with the sheet still unchanged must not retire it.
data = sheet([row()])
stats = E.apply(data)
check("still applied on the next poll", data["games"]["rows"][0].get("playingStatus"), "Playing")
check("not retired", stats["retired"], 0)

# ---- 2. the sheet catches up -> retire -------------------------------------
print("sheet catches up")
data = sheet([row(playingStatus="Playing")])          # you keyed it into Excel
stats = E.apply(data)
check("retired", stats["retired"], 1)
check("nothing staged", E.counts()["fields"], 0)
check("value still right", data["games"]["rows"][0].get("playingStatus"), "Playing")

# ---- 3. the sheet moves underneath us -> conflict --------------------------
print("sheet moves underneath")
E = new_store()
data = sheet([row(rating=0.8)])
E.stage_field("games", KEY, "rating", 0.95, 0.8)       # base = what the sheet said
E.apply(data)
check("applied over the base", data["games"]["rows"][0]["rating"], 0.95)
data = sheet([row(rating=0.7)])                        # Excel now says something else
stats = E.apply(data)
check("conflict raised", stats["conflicts"], 1)
check("the sheet wins", data["games"]["rows"][0]["rating"], 0.7)
check("counted as a conflict", E.counts()["conflicts"], 1)
# A conflicted edit stays out of the way on every later pass.
data = sheet([row(rating=0.7)])
E.apply(data)
check("still not applied", data["games"]["rows"][0]["rating"], 0.7)
pending = E.pending()["fields"][0]
check("conflict reports the sheet's value", pending["sheetValue"], 0.7)
check("conflict reports ours", pending["value"], 0.95)

# ---- 4. the row disappears -> orphan, and comes back -----------------------
print("row disappears")
E = new_store()
E.stage_field("games", KEY, "owned", True, None)
E.apply(sheet([]))
check("orphaned", E.counts()["orphans"], 1)
data = sheet([row()])                                  # renamed back / un-deleted
E.apply(data)
check("un-orphaned", E.counts()["orphans"], 0)
check("applied again", data["games"]["rows"][0].get("owned"), True)

# ---- 5. write-through must not judge ---------------------------------------
print("write-through does not retire")
E = new_store()
data = sheet([row()])
E.stage_field("games", KEY, "completionTime", 24.5, None)
E.apply(data)                                          # fresh-parse pass
E.apply(data, retire=False)                            # the path a write takes
check("edit survives the write-through", E.counts()["fields"], 1)
check("value intact", data["games"]["rows"][0]["completionTime"], 24.5)
# The bug this guards: judging the live rows sees our own value as "the sheet
# agrees" and throws the edit away.
E.apply(data, retire=False)
check("survives a second write-through", E.counts()["fields"], 1)

# ---- 6. a staged clear -----------------------------------------------------
print("staged clear")
E = new_store()
data = sheet([row(notes="Two copies owned")])
E.stage_field("games", KEY, "notes", None, "Two copies owned")
E.apply(data)
check("cell emptied", "notes" in data["games"]["rows"][0], False)
data = sheet([row()])                                  # Excel's cell is empty now too
check("retired once the sheet agrees", E.apply(data)["retired"], 1)

# ---- 7. dropping an edit restores the sheet's value ------------------------
print("drop restores base")
E = new_store()
data = sheet([row(rating=0.6)])
E.stage_field("games", KEY, "rating", 0.9, 0.6)
E.apply(data)
res = E.drop_field("games", KEY, "rating")
check("drop reports the base", res["base"], 0.6)
E.restore(data, "games", KEY, "rating", res["base"])
check("sheet value back on screen", data["games"]["rows"][0]["rating"], 0.6)
check("no longer marked as yours", data["games"]["rows"][0].get("_edited"), [])

# ---- 8. added rows ---------------------------------------------------------
print("added rows")
E = new_store()
staged = E.add_row("games", {
    "title": "Panzer Dragoon Saga", "platform": "Sega Saturn", "releaseYear": 1998,
    "genre": "RPG", "owned": True, "purchasePrice": 400.0,
    "priority": "Must Play", "notes": "Two copies owned",
}, igdb_id=4242)
data = sheet([row()])
stats = E.apply(data)
check("injected", stats["added"], 1)
added = [r for r in data["games"]["rows"] if r.get("_added")][0]
check("carries its id", added["_rowId"], staged["rowId"])
check("coded column kept as a label", added["priority"], "Must Play")
check("notes unpacked like a real row", added.get("physicalMedia") is not None
      or added.get("edition") is not None or "notes" in added, True)
check("stamped with its match key", added["_k"],
      match_key_for("Panzer Dragoon Saga", "Sega Saturn", 1998))
# Quick-logging an added row rewrites its stored cells — and the replacement row
# must keep the identity, or it is served with no cover and no metadata.
E.update_added(staged["rowId"], {"playingStatus": "Playing"})
E.rewrite_injected(data, staged["rowId"], E.pending()["added"][0]["fields"])
again = [r for r in data["games"]["rows"] if r.get("_rowId") == staged["rowId"]][0]
check("rewritten cell", again["playingStatus"], "Playing")
check("identity survives the rewrite", again["_k"], added["_k"])
check("other cells survive", again["purchasePrice"], 400.0)
check("pin key matches", E.igdb_pin_for(staged["rowId"])[0],
      match_key_for("Panzer Dragoon Saga", "Sega Saturn", 1998))
check("pinned igdb id", E.igdb_pin_for(staged["rowId"])[1], 4242)
check("in added_keys", match_key_for("Panzer Dragoon Saga", "Sega Saturn", 1998) in E.added_keys(), True)
# Write-through must not inject it twice, or retire it for existing.
E.apply(data, retire=False)
check("not double-injected", len([r for r in data["games"]["rows"] if r.get("_added")]), 1)
check("not retired by its own injection", E.counts()["added"], 1)
# …and once the workbook has it for real, the staged copy steps aside.
real = {"title": "Panzer Dragoon Saga", "platform": "Sega Saturn", "releaseYear": 1998,
        "owned": True}
data = sheet([row(), real])
E.apply(data)
check("retired by the real row", E.counts()["added"], 0)
check("no duplicate on screen",
      len([r for r in data["games"]["rows"] if r.get("title") == "Panzer Dragoon Saga"]), 1)

# ---- 9. validation ---------------------------------------------------------
print("validation")
E = new_store()


def refuses(label, fn):
    try:
        fn()
    except edits_mod.EditError:
        print(f"  ok   {label}")
        return
    FAILED.append(f"{label}: accepted a value it should refuse")
    print(f"  FAIL {label}: accepted")


refuses("a rating above 1", lambda: E.stage_field("games", KEY, "rating", 95, None))
refuses("a negative price", lambda: E.stage_field("games", KEY, "purchasePrice", -5, None))
refuses("an unknown label", lambda: E.stage_field("games", KEY, "priority", "Sometime", None))
refuses("a non-date", lambda: E.stage_field("games", KEY, "dateCompleted", "yesterday", None))
refuses("the title (identity)", lambda: E.stage_field("games", KEY, "title", "X", None))
refuses("the platform (identity)", lambda: E.stage_field("games", KEY, "platform", "X", None))
refuses("a column off the allowlist", lambda: E.stage_field("games", KEY, "genre", "RPG", None))
refuses("a row with no platform",
        lambda: E.add_row("games", {"title": "Nights into Dreams"}))
check("a real label is accepted",
      E.stage_field("games", KEY, "priority", "Want to Play", None), "Want to Play")
check("excel code for the label", E.pending()["fields"][0]["sheetCode"], "3")
check("percent accepted as a fraction",
      E.stage_field("games", KEY, "rating", 0.85, None), 0.85)

# ---- 10. platform name mapping --------------------------------------------
print("igdb -> sheet platform")
for igdb_name, want in [
    ("Nintendo 64", "Nintendo 64"),
    ("PlayStation 2", "PlayStation 2"),
    ("Sega Saturn", "Sega Saturn"),
    ("PC (Microsoft Windows)", "PC"),              # parenthetical short name
    # The alias table is many-to-one on purpose — BS-X claims every SNES alias,
    # because a Satellaview game's platform reads as "SNES" elsewhere. The
    # acronym rule is what stops the inversion putting SNES games on the BS-X.
    ("Super Nintendo Entertainment System", "SNES"),
    ("Nintendo Entertainment System", "NES"),
    ("Wii", "Nintendo Wii"),                       # vs WiiWare: the maker-prefix rule
    ("TurboGrafx-16/PC Engine", "TurboGrafx-16"),  # IGDB's paired names
    ("Sega Mega Drive/Genesis", "Sega Genesis"),
    ("Dreamcast", "Sega Dreamcast"),
    # Genuinely ambiguous (BS-X vs SNES, and the sheet files Linux under PC):
    # answering None is the point — the add form asks instead of guessing wrong.
    ("Super Famicom", None),
    ("Linux", None),
]:
    check(f"{igdb_name!r}", edits_mod.sheet_platform(igdb_name), want)

print()
if FAILED:
    print(f"{len(FAILED)} FAILURE(S):")
    for f in FAILED:
        print(" -", f)
    sys.exit(1)
print("all checks passed")
