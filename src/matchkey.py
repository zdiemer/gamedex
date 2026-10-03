"""A row's identity: which sheet column holds its title, and its match key.

Pulled out of enrich.py because it is not about enrichment. The key is what joins
a spreadsheet row to everything keyed on it — every provider's cache, the staged
edits overlay (edits.py), the platform-library matches — so it has to be ONE
function. enrich.py's Enricher.key_for and edits.py both call this; two
implementations would be two subtly different identities for the same game.

It also keeps the overlay cheap to reason about: edits.py needs the key of a row
the enricher has not indexed yet, and importing enrich.py for it would drag in
every crawler client (requests, bs4, curl_cffi, PyMuPDF) to compose three strings.
"""

from __future__ import annotations

from match_validator import MatchValidator

# Which column carries the title, per logical sheet. The Completed sheet calls it
# "Game" where the others say "Title".
SHEET_TITLE = {"games": "title", "completed": "game", "onOrder": "title"}

_VALIDATOR = MatchValidator()


def match_key_for(title, platform, year) -> str:
    """normalize(title)|platform|year — the identity of one platform copy.

    One row per copy, which is why the platform is in the key: the sheet keeps
    Chrono Trigger (SNES) and Chrono Trigger (DS) as separate games, and so does
    everything that hangs off this.
    """
    return f"{_VALIDATOR.normalize(title)}|{(platform or '').lower()}|{year or ''}"
