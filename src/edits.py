"""Staged edits: writes from the web while the spreadsheet is still the truth.

Phase 1 of the rewrite in TODO.md. Two kinds of write land here, both admin-only:

  * a FIELD EDIT — the quick-log verbs ("mark finished", "set status", "log
    hours", "rate it") change one cell of one row;
  * an ADDED ROW — a game picked out of IGDB search, with its universal metadata
    filled in from the IGDB record and your sheet-specific columns (owned,
    format, condition, what you paid) typed once.

Neither touches the workbook. The edits live in SQLite on the same PVC as
everything else and are overlaid onto the parsed dataset on the way out, so the
app shows your change immediately and the Dropbox file stays the source of
truth. Writing back would mean a Dropbox app token and a server write racing
whatever machine has the workbook open in Excel — that makes conflicted copies,
not backups. The pending list is the reconciliation UI instead, and it doubles
as the seed for phase 2, where the DB becomes truth.

The subtle part is not writing but RETIRING. An overlay that outlives the edit it
describes silently shadows the spreadsheet: you type the same change into Excel,
the sheet catches up, and the stale overlay goes on asserting the value forever —
including over a LATER edit you make in Excel. So every staged edit records the
value the sheet had when it was made (`base`), and each fresh parse re-judges it:

    sheet now == our value   -> retire it (you keyed it in; we're done)
    sheet now != base        -> CONFLICT: the sheet moved underneath us. The
                                sheet wins, we stop applying, the UI shows both.
    otherwise                -> apply it

Row identity is the enricher's match key (normalize(title)|platform|year), which
is all phase 1 has. Two sheet rows can collide on it — the same game, same
platform, same year, logged twice — and an edit then applies to both; the write
endpoint says so in its response rather than pretending the rows are distinct.
Editing the three fields the key is made of is refused outright: changing them
moves a row's identity and orphans every enrichment join hanging off it.
"""

from __future__ import annotations

import json
import logging
import secrets
import sqlite3
import threading
from datetime import datetime, timezone

import parse as parse_mod
from constants import PLATFORM_NAMES
from excel_game import ExcelPlatform
from matchkey import SHEET_TITLE, match_key_for

log = logging.getLogger("gamedex.edits")

_now = lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")

# Which columns a web write may touch, per sheet. An allowlist, like prefs.KEYS:
# everything here is a personal fact about YOUR copy — status, progress, rating,
# dates, what you paid, your notes — which is exactly the set the quick-log verbs
# and the add form need. Universal metadata (genre, publisher, developer) is not
# editable through a field edit: it comes from IGDB, and phase 2 makes those
# per-user overrides on the IGDB record rather than cell writes.
EDITABLE = {
    "games": {
        "rating", "playingStatus", "playingProgress", "priority", "owned", "completed",
        "wishlisted", "playable", "vr", "dlc", "english", "format", "condition",
        "datePurchased", "purchasePrice", "dateStarted", "dateCompleted",
        "completionTime", "estimatedTime", "dateAdded", "notes",
    },
    "completed": {
        "rating", "date", "started", "playTime", "steamDeck", "emulated", "vr",
        "collection", "notes",
    },
    "onOrder": {"vendor", "status", "format", "price", "orderedDate", "estimatedRelease"},
}

# The three fields the match key is built from. Off limits (see the module docstring).
IDENTITY = {"title", "game", "platform", "releaseYear", "release", "releaseDate"}

# A sheet row's columns, in the shape the add form submits them. Anything outside
# EDITABLE[sheet] | _ADD_ONLY is dropped from a new row rather than silently stored.
_ADD_ONLY = {
    "games": {"title", "platform", "releaseDate", "releaseYear", "releaseRegion",
              "genre", "franchise", "publisher", "developer", "metacriticRating",
              "gamefaqsUserRating", "mameRomset", "fileSize"},
    "completed": {"game", "platform", "release", "region", "genre", "franchise",
                  "publisher", "developer", "criticScore"},
    "onOrder": {"title", "platform"},
}

MAX_TEXT = 20000            # the Completed sheet's reviews are long-form
MAX_ADDED = 2000            # a staged row is a few hundred bytes; this is a disk guard


class EditError(ValueError):
    """A write the sheet's own schema would not accept."""


# ---- value validation ----------------------------------------------------
def _coerce_for(sheet: str, column: str, value):
    """Return `value` as a cell of this column's type, or raise EditError.

    The result has to be indistinguishable from what parse.py would have produced
    for the same cell — a coded column carries its LABEL ("Want to Play"), not the
    3 that is in the spreadsheet, because that is what every row in the dataset
    carries and what the facets are built from.
    """
    types = parse_mod.column_types(sheet)
    if column not in types:
        raise EditError(f"unknown column {column!r} on sheet {sheet!r}")
    ctype = types[column]
    if value is None or (isinstance(value, str) and not value.strip()):
        return None                              # a staged clear: empty the cell

    labels = parse_mod.labels_for(column)
    if labels:
        if value not in labels.values():
            raise EditError(f"{column} must be one of: {', '.join(sorted(labels.values()))}")
        return value

    out = parse_mod.coerce(value, ctype)
    if out is None:
        raise EditError(f"{value!r} is not a valid {ctype} for {column}")
    if ctype == "rating":
        if not 0 <= out <= 1:
            raise EditError(f"{column} is a 0..1 fraction (got {value!r})")
    elif ctype in ("hours", "money", "number", "int"):
        if out < 0:
            raise EditError(f"{column} cannot be negative")
    elif ctype == "date":
        if not (isinstance(out, str) and len(out) == 10 and out[4] == out[7] == "-"):
            raise EditError(f"{column} must be a YYYY-MM-DD date (got {value!r})")
    elif ctype == "text" and len(out) > MAX_TEXT:
        raise EditError(f"{column} is longer than {MAX_TEXT} characters")
    return out


def _same(a, b, ctype) -> bool:
    """Is the sheet's cell the same value as ours? Floats by tolerance, because a
    rating that round-trips through Excel and JSON is not bit-identical."""
    if a is None or b is None:
        return a is None and b is None
    if ctype in ("rating", "hours", "money", "number"):
        try:
            return abs(float(a) - float(b)) < 1e-6
        except (TypeError, ValueError):
            return str(a) == str(b)
    if ctype == "bool":
        return bool(a) == bool(b)
    return str(a) == str(b)


# ---- platform mapping ----------------------------------------------------
# IGDB's platform names are not the spreadsheet's: "Nintendo 64" agrees, but
# "PC (Microsoft Windows)" and "Super Nintendo Entertainment System" do not. The
# validator already owns this vocabulary, so invert its alias table rather than
# writing a second one — but inverting it needs care, because the table is
# deliberately many-to-one. BS-X (the Satellaview) lists every SNES alias, since a
# BS-X game's platform reads as "SNES" in other databases, and a naive inversion
# duly maps IGDB's SNES to BS-X.
#
# So an alias two platforms both claim is resolved only if one of them OWNS it:
# the alias is that platform's own name, or its acronym ("snes" is exactly what
# "super nintendo entertainment system" initials out to). Anything still ambiguous
# answers None, and the add form asks — a wrong guess here invents a row on the
# wrong platform, which is worse than one dropdown.
def _initials(text: str) -> str:
    return "".join(w[0] for w in text.split() if w)


def _fold(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum() or c == " ").strip()


_PLATFORM_EXACT = {_fold(p.value): p.value for p in ExcelPlatform}
_PLATFORM_ALIAS: dict = {}
for _p, _aliases in PLATFORM_NAMES.items():
    for _a in _aliases:
        _PLATFORM_ALIAS.setdefault(_fold(_a), []).append(_p.value)


# Stripped when deciding which of two claimants owns an alias: "wii" is claimed by
# Nintendo Wii and by WiiWare, and the console is the one whose whole name is the
# alias plus a maker's name.
_MAKERS = ("nintendo", "sega", "sony", "microsoft", "atari", "nec", "snk", "apple",
           "commodore", "amstrad", "acorn", "bandai", "panasonic", "philips", "sharp")


def _owns(value: str, alias: str) -> bool:
    folded = _fold(value)
    if folded == alias or folded == _initials(alias):
        return True
    maker, _, rest = folded.partition(" ")
    return maker in _MAKERS and rest == alias


def _from_alias(name: str) -> str | None:
    claims = _PLATFORM_ALIAS.get(name)
    if not claims:
        return None
    if len(set(claims)) == 1:
        return claims[0]
    owners = {c for c in claims if _owns(c, name)}
    return next(iter(owners)) if len(owners) == 1 else None


def _candidates(igdb_name: str):
    """The strings worth looking up, best first.

    IGDB writes several platforms as a pair ("Sega Mega Drive/Genesis",
    "TurboGrafx-16/PC Engine") or with the short name in parentheses ("PC
    (Microsoft Windows)"), and the spreadsheet picked one side of each.
    """
    raw = igdb_name.strip()
    yield _fold(raw)
    if "(" in raw and raw.endswith(")"):
        yield _fold(raw[raw.index("(") + 1:-1])
        yield _fold(raw[:raw.index("(")])
    if "/" in raw:
        for part in raw.split("/"):
            yield _fold(part)


def sheet_platform(igdb_name: str) -> str | None:
    """The spreadsheet's name for an IGDB platform, or None if we can't be sure."""
    if not igdb_name:
        return None
    for name in _candidates(igdb_name):
        if not name:
            continue
        if name in _PLATFORM_EXACT:
            return _PLATFORM_EXACT[name]
        hit = _from_alias(name)
        if hit:
            return hit
    return None


def sheet_platforms(igdb_names) -> list[str]:
    """Distinct, confidently mapped sheet platforms for an IGDB game.

    Recommendation cards need the same mapping as the add-game search, but their
    metadata arrives through the batched ``/api/games/meta`` path. Keep the
    conversion here so both surfaces make exactly the same platform decision.
    Unknown or ambiguous names are omitted; the swipe UI then asks rather than
    filing a game under the wrong machine.
    """
    out = []
    for name in igdb_names or []:
        mapped = sheet_platform(name)
        if mapped and mapped not in out:
            out.append(mapped)
    return out


def fields_from_igdb(record: dict, platform: str | None = None) -> dict:
    """Suggested sheet cells for a game picked out of IGDB search.

    The point of adding by IGDB id is not typing metadata twice. The sheet keeps
    ONE value per column where IGDB keeps a list, so the primary (first) entry is
    the suggestion — the add form shows it as an editable field, because IGDB's
    vocabulary and the sheet's are not the same ("Role-playing (RPG)" where the
    sheet has said "RPG" for twenty years) and only you can say which it is.
    """
    first = lambda xs: next((x for x in (xs or []) if x), None)
    out = {
        "title": record.get("name"),
        "releaseDate": record.get("igdbReleaseDate"),
        "releaseYear": record.get("year"),
        "genre": first(record.get("genres")),
        "franchise": first(record.get("franchises")),
        "publisher": first(record.get("publishers")),
        "developer": first(record.get("developers")),
    }
    if platform:
        out["platform"] = platform
    return {k: v for k, v in out.items() if v not in (None, "")}


# ---- the store -----------------------------------------------------------
def index_rows(parsed: dict) -> dict:
    """{(sheet, match_key): [rows]} for a whole dataset, built in one pass.

    Reads `_k` when the enricher has already stamped it (the write-through path,
    on the live dataset) and computes it otherwise (the fresh-parse path, where
    the overlay deliberately runs BEFORE reindex). Built once per overlay pass
    rather than per edit: normalize() over 15k rows is cheap once and absurd
    fifty times.
    """
    idx = {}
    for sheet, title_field in SHEET_TITLE.items():
        for r in (parsed.get(sheet) or {}).get("rows") or []:
            key = r.get("_k")
            if not key:
                title = r.get(title_field)
                if not title:
                    continue
                key = match_key_for(title, r.get("platform"), r.get("releaseYear"))
            idx.setdefault((sheet, key), []).append(r)
    return idx


def find_rows(parsed: dict, sheet: str, match_key: str) -> list:
    """The rows on `sheet` with this match key — a one-off lookup for a write
    endpoint reading the pre-edit value. Same `_k`-or-compute rule as index_rows,
    which means it costs nothing on the live (stamped) dataset."""
    title_field = SHEET_TITLE.get(sheet)
    if not title_field:
        return []
    out = []
    for r in (parsed.get(sheet) or {}).get("rows") or []:
        key = r.get("_k")
        if not key:
            title = r.get(title_field)
            if not title:
                continue
            key = match_key_for(title, r.get("platform"), r.get("releaseYear"))
        if key == match_key:
            out.append(r)
    return out


class Edits:
    def __init__(self, db_path: str):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS field_edits("
            " sheet TEXT NOT NULL, match_key TEXT NOT NULL, column_key TEXT NOT NULL,"
            " value TEXT, base TEXT, state TEXT NOT NULL DEFAULT 'pending',"
            " sheet_value TEXT, created_at TEXT, updated_at TEXT,"
            " PRIMARY KEY(sheet, match_key, column_key))"
        )
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS added_rows("
            " row_id TEXT PRIMARY KEY, sheet TEXT NOT NULL, igdb_id INTEGER,"
            " fields TEXT NOT NULL, created_at TEXT, updated_at TEXT, retired_at TEXT)"
        )
        self._db.commit()

    # -- field edits --------------------------------------------------------
    def stage_field(self, sheet: str, match_key: str, column: str, value, base):
        """Record one cell change. `base` is what the sheet says RIGHT NOW — the
        caller reads it off the live dataset, and retirement is judged against it.

        Returns the coerced value, which is what the overlay will serve.
        """
        if sheet not in EDITABLE:
            raise EditError(f"sheet {sheet!r} is not editable")
        if column in IDENTITY:
            raise EditError(f"{column} is part of a row's identity and can't be edited yet")
        if column not in EDITABLE[sheet]:
            raise EditError(f"{column} is not editable on the {sheet} sheet")
        coerced = _coerce_for(sheet, column, value)
        now = _now()
        with self._lock:
            self._db.execute(
                "INSERT INTO field_edits"
                "(sheet,match_key,column_key,value,base,state,sheet_value,created_at,updated_at)"
                " VALUES(?,?,?,?,?, 'pending', NULL, ?, ?)"
                " ON CONFLICT(sheet,match_key,column_key) DO UPDATE SET"
                " value=excluded.value, base=excluded.base, state='pending',"
                " sheet_value=NULL, updated_at=excluded.updated_at",
                (sheet, match_key, column, json.dumps(coerced), json.dumps(base), now, now),
            )
            self._db.commit()
        return coerced

    def drop_field(self, sheet: str, match_key: str, column: str) -> dict:
        """Discard a staged edit.

        Returns {dropped, base, state}. `base` is the cell the sheet had before the
        edit, which is what the caller puts back into the live rows — the rows on
        screen still carry our value, and a re-poll can't undo it (the workbook
        hash hasn't changed, so there is nothing to re-parse). Only a 'pending'
        edit was ever applied: a conflicted one left the sheet's own value in
        place, so restoring `base` over it would be a second wrong answer.
        """
        with self._lock:
            row = self._db.execute(
                "SELECT base,state FROM field_edits WHERE sheet=? AND match_key=? AND column_key=?",
                (sheet, match_key, column)).fetchone()
            if not row:
                return {"dropped": False, "base": None, "state": None}
            self._db.execute(
                "DELETE FROM field_edits WHERE sheet=? AND match_key=? AND column_key=?",
                (sheet, match_key, column))
            self._db.commit()
        return {"dropped": True, "state": row[1],
                "base": json.loads(row[0]) if row[0] is not None else None}

    def restore(self, parsed: dict, sheet: str, match_key: str, column: str, base) -> int:
        """Put a dropped edit's pre-edit value back into the live rows."""
        n = 0
        for r in find_rows(parsed, sheet, match_key):
            if r.get("_rowId"):
                continue
            if base is None:
                r.pop(column, None)
            else:
                r[column] = base
            edited = r.get("_edited")
            if edited and column in edited:
                edited.remove(column)
            n += 1
        return n

    # -- added rows ---------------------------------------------------------
    def add_row(self, sheet: str, fields: dict, igdb_id=None) -> dict:
        """Stage a whole new row. Returns {rowId, fields} with the coerced cells."""
        if sheet not in EDITABLE:
            raise EditError(f"sheet {sheet!r} is not editable")
        clean = self._clean_row(sheet, fields)
        title_field = SHEET_TITLE[sheet]
        if not clean.get(title_field):
            raise EditError(f"a new {sheet} row needs a {title_field}")
        if not clean.get("platform"):
            raise EditError("a new row needs a platform")
        with self._lock:
            n = self._db.execute(
                "SELECT COUNT(*) FROM added_rows WHERE retired_at IS NULL").fetchone()[0]
            if n >= MAX_ADDED:
                raise EditError(f"too many staged rows ({n}); reconcile some first")
            row_id = "add:" + secrets.token_hex(6)
            now = _now()
            self._db.execute(
                "INSERT INTO added_rows(row_id,sheet,igdb_id,fields,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?)",
                (row_id, sheet, int(igdb_id) if igdb_id else None, json.dumps(clean), now, now))
            self._db.commit()
        return {"rowId": row_id, "fields": clean}

    def update_added(self, row_id: str, fields: dict) -> dict:
        with self._lock:
            row = self._db.execute(
                "SELECT sheet,fields FROM added_rows WHERE row_id=?", (row_id,)).fetchone()
        if not row:
            raise EditError(f"no staged row {row_id!r}")
        sheet, existing = row[0], json.loads(row[1])
        merged = {**existing, **self._clean_row(sheet, fields)}
        # An explicit null is a cleared cell, not a no-op. _clean_row drops Nones
        # (the add form posts every field, most of them empty), so the clears have
        # to be re-read off the submitted keys.
        allowed = EDITABLE[sheet] | _ADD_ONLY.get(sheet, set())
        for key, value in (fields or {}).items():
            if key in allowed and (value is None or (isinstance(value, str) and not value.strip())):
                merged.pop(key, None)
        title_field = SHEET_TITLE[sheet]
        if not merged.get(title_field) or not merged.get("platform"):
            raise EditError(f"a {sheet} row needs a {title_field} and a platform")
        with self._lock:
            self._db.execute("UPDATE added_rows SET fields=?, updated_at=? WHERE row_id=?",
                             (json.dumps(merged), _now(), row_id))
            self._db.commit()
        return {"rowId": row_id, "fields": merged}

    def delete_added(self, row_id: str) -> bool:
        with self._lock:
            cur = self._db.execute("DELETE FROM added_rows WHERE row_id=?", (row_id,))
            self._db.commit()
            return cur.rowcount > 0

    def key_for_fields(self, sheet: str, fields: dict) -> str | None:
        """The match key a submitted row WILL have once it's staged.

        Computed off the coerced cells, not the raw ones, so the duplicate check and
        the IGDB pin agree with the row that actually lands: a releaseYear the sheet
        schema throws away ("Early Access") must not survive in the key.
        """
        clean = self._clean_row(sheet, fields)
        title = clean.get(SHEET_TITLE.get(sheet, "title"))
        if not title:
            return None
        return match_key_for(title, clean.get("platform"), clean.get("releaseYear"))

    def rewrite_injected(self, parsed: dict, row_id: str, fields: dict) -> int:
        """Replace an injected row's cells in the live dataset after an update."""
        n = 0
        for sheet_key, sheet in (parsed or {}).items():
            for i, r in enumerate(sheet.get("rows") or []):
                if r.get("_rowId") != row_id:
                    continue
                row = dict(fields, _rowId=row_id, _added=True)
                title = fields.get(SHEET_TITLE.get(sheet_key, "title"))
                if title:
                    # Re-stamp the identity the enricher would: this replaces the row
                    # object outright, and a row served without `_k` loses its cover,
                    # its metadata and every join until the next reindex.
                    row["_k"] = match_key_for(title, fields.get("platform"),
                                              fields.get("releaseYear"))
                if sheet_key == "games":
                    parse_mod.inject_derived(row)
                sheet["rows"][i] = row
                n += 1
        return n

    def remove_injected(self, parsed: dict, row_id: str) -> int:
        """Drop an injected row from the live dataset after it's discarded."""
        n = 0
        for sheet in (parsed or {}).values():
            rows = sheet.get("rows")
            if not rows:
                continue
            keep = [r for r in rows if r.get("_rowId") != row_id]
            n += len(rows) - len(keep)
            sheet["rows"] = keep
        return n

    def _clean_row(self, sheet: str, fields: dict) -> dict:
        """Coerce a submitted row, dropping anything outside the allowlist."""
        allowed = EDITABLE[sheet] | _ADD_ONLY.get(sheet, set())
        out = {}
        for key, value in (fields or {}).items():
            if key not in allowed:
                continue                        # not an error: the form posts extras
            coerced = _coerce_for(sheet, key, value)
            if coerced is not None:
                out[key] = coerced
        return out

    # -- reads --------------------------------------------------------------
    def pending(self) -> dict:
        """Everything staged, for the reconciliation UI. Each field edit carries the
        code to type into Excel, which is the thing you actually need in front of
        the spreadsheet."""
        with self._lock:
            fields = self._db.execute(
                "SELECT sheet,match_key,column_key,value,base,state,sheet_value,updated_at"
                " FROM field_edits ORDER BY updated_at DESC").fetchall()
            added = self._db.execute(
                "SELECT row_id,sheet,igdb_id,fields,created_at,retired_at"
                " FROM added_rows ORDER BY created_at DESC").fetchall()
        out_fields = []
        for sheet, key, col, value, base, state, sheet_value, updated in fields:
            v = json.loads(value) if value is not None else None
            out_fields.append({
                "sheet": sheet, "matchKey": key, "column": col, "value": v,
                "base": json.loads(base) if base is not None else None,
                "state": state,
                "sheetValue": json.loads(sheet_value) if sheet_value is not None else None,
                "sheetCode": parse_mod.code_for_label(col, v),
                "updatedAt": updated,
            })
        return {
            "fields": out_fields,
            "added": [{
                "rowId": r[0], "sheet": r[1], "igdbId": r[2],
                "matchKey": self.key_for_fields(r[1], json.loads(r[3])),
                "fields": json.loads(r[3]), "createdAt": r[4], "retiredAt": r[5],
            } for r in added],
        }

    def version(self) -> int:
        """A number that changes whenever anything is staged, retired or dropped.

        /api/data serves a pre-gzipped body keyed on the workbook hash, and a write
        does not change the workbook — without this in the key, the first edit would
        be invisible until the next time the spreadsheet itself moved.
        """
        return self._db.total_changes

    def counts(self) -> dict:
        with self._lock:
            pend = self._db.execute(
                "SELECT COUNT(*) FROM field_edits WHERE state='pending'").fetchone()[0]
            conflict = self._db.execute(
                "SELECT COUNT(*) FROM field_edits WHERE state='conflict'").fetchone()[0]
            orphan = self._db.execute(
                "SELECT COUNT(*) FROM field_edits WHERE state='orphan'").fetchone()[0]
            added = self._db.execute(
                "SELECT COUNT(*) FROM added_rows WHERE retired_at IS NULL").fetchone()[0]
        return {"fields": pend, "conflicts": conflict, "orphans": orphan, "added": added}

    def added_keys(self) -> list:
        """Match keys of the live staged rows — what to hand the enricher so a game
        added from the web gets the same provider fan-out a sheet row gets."""
        with self._lock:
            rows = self._db.execute(
                "SELECT sheet,fields FROM added_rows WHERE retired_at IS NULL").fetchall()
        keys = []
        for sheet, fields in rows:
            f = json.loads(fields)
            title = f.get(SHEET_TITLE.get(sheet, "title"))
            if title:
                keys.append(match_key_for(title, f.get("platform"), f.get("releaseYear")))
        return keys

    def igdb_pin_for(self, row_id: str):
        """(match_key, igdb_id) for a staged row, so the add endpoint can pin the
        exact IGDB record the user chose instead of leaving it to the fuzzy matcher."""
        with self._lock:
            row = self._db.execute(
                "SELECT sheet,igdb_id,fields FROM added_rows WHERE row_id=?", (row_id,)).fetchone()
        if not row:
            return None, None
        sheet, igdb_id, fields = row[0], row[1], json.loads(row[2])
        title = fields.get(SHEET_TITLE.get(sheet, "title"))
        if not title:
            return None, igdb_id
        return match_key_for(title, fields.get("platform"), fields.get("releaseYear")), igdb_id

    # -- the overlay --------------------------------------------------------
    def apply(self, parsed: dict, retire: bool = True) -> dict:
        """Overlay every staged write onto a parsed dataset, in place.

        `retire=True` is the fresh-parse path (the poller's on_update hook): the
        sheet values in `parsed` came straight from the workbook, so they can be
        judged against `base` to retire finished edits and flag conflicts.

        `retire=False` is the write-through path, called on the LIVE dataset after
        a write so the change shows up before the next poll. It must not judge:
        the live rows already carry the overlay, so "the sheet agrees with us" is
        just our own value read back, and retiring on it would throw the edit away.
        """
        if not parsed:
            return {"added": 0, "applied": 0, "retired": 0, "conflicts": 0}
        # One index for the whole pass: injection reads it to decide whether the
        # workbook has caught up with a staged row, and the field-edit loop reads
        # it to find its targets.
        idx = index_rows(parsed)
        stats = {"added": self._inject_added(parsed, idx, retire), "applied": 0,
                 "retired": 0, "conflicts": 0}

        with self._lock:
            edits = self._db.execute(
                "SELECT sheet,match_key,column_key,value,base,state FROM field_edits").fetchall()
        for sheet, key, col, value, base, state in edits:
            if state == "conflict":
                continue                        # the sheet won; nothing to apply
            # A staged row is edited through update_added (its cells live in
            # added_rows, not in the sheet), so it is never a field-edit target —
            # retirement would judge our own injected value and drop the edit.
            rows = [r for r in (idx.get((sheet, key)) or []) if not r.get("_rowId")]
            if not rows:
                if retire and state != "orphan":
                    self._set_state(sheet, key, col, "orphan", None)
                continue
            if state == "orphan" and retire:
                self._set_state(sheet, key, col, "pending", None)
            want = json.loads(value) if value is not None else None
            ctype = parse_mod.column_types(sheet).get(col, "text")
            if retire:
                current = rows[0].get(col)
                if _same(current, want, ctype):
                    self._forget(sheet, key, col)      # the sheet caught up
                    stats["retired"] += 1
                    continue
                base_v = json.loads(base) if base is not None else None
                if not _same(current, base_v, ctype):
                    self._set_state(sheet, key, col, "conflict", current)
                    stats["conflicts"] += 1
                    log.info("edits: conflict on %s/%s/%s (sheet=%r, staged=%r)",
                             sheet, key, col, current, want)
                    continue
            for r in rows:
                if want is None:
                    r.pop(col, None)            # a staged clear empties the cell
                else:
                    r[col] = want
                # The UI marks an overlaid cell as yours-not-the-sheet's, so a value
                # that hasn't been reconciled yet is never mistaken for one that has.
                edited = r.setdefault("_edited", [])
                if col not in edited:
                    edited.append(col)
            stats["applied"] += 1
        return stats

    def _inject_added(self, parsed: dict, idx: dict, retire: bool) -> int:
        """Append the staged rows to their sheet, skipping any the workbook now has.

        The retirement rule for a row rather than a cell: once a real sheet row
        shares its match key, the staged copy stops being injected (or you would
        see the game twice, and the second one would never go away).
        """
        with self._lock:
            rows = self._db.execute(
                "SELECT row_id,sheet,fields FROM added_rows WHERE retired_at IS NULL").fetchall()
        n = 0
        for row_id, sheet, fields in rows:
            target = parsed.get(sheet)
            if not target:
                continue
            existing = target.setdefault("rows", [])
            if any(r.get("_rowId") == row_id for r in existing):
                continue                        # already overlaid (write-through path)
            f = json.loads(fields)
            title = f.get(SHEET_TITLE.get(sheet, "title"))
            if not title:
                continue
            key = match_key_for(title, f.get("platform"), f.get("releaseYear"))
            # Only a REAL sheet row retires a staged one. On the write-through path
            # the dataset already holds rows we injected earlier, and counting those
            # as "the sheet has it now" would retire every staged row on first write.
            if any(not r.get("_rowId") for r in idx.get((sheet, key)) or []):
                if retire:
                    self._retire_added(row_id)
                    log.info("edits: staged row %s is in the sheet now — retired", row_id)
                continue
            row = dict(f)
            row["_rowId"] = row_id
            row["_added"] = True
            # The enricher would stamp this on its next pass; do it now so a row is
            # never served without the key everything joins on.
            row["_k"] = key
            if sheet == "games":
                parse_mod.inject_derived(row)   # Notes unpacking, the TBD-year fallback
            existing.append(row)
            idx.setdefault((sheet, key), []).append(row)
            n += 1
        return n

    def _forget(self, sheet, key, col):
        with self._lock:
            self._db.execute(
                "DELETE FROM field_edits WHERE sheet=? AND match_key=? AND column_key=?",
                (sheet, key, col))
            self._db.commit()

    def _set_state(self, sheet, key, col, state, sheet_value):
        with self._lock:
            self._db.execute(
                "UPDATE field_edits SET state=?, sheet_value=?, updated_at=?"
                " WHERE sheet=? AND match_key=? AND column_key=?",
                (state, json.dumps(sheet_value), _now(), sheet, key, col))
            self._db.commit()

    def _retire_added(self, row_id):
        with self._lock:
            self._db.execute("UPDATE added_rows SET retired_at=? WHERE row_id=?",
                             (_now(), row_id))
            self._db.commit()
