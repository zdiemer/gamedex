"""Shared answer eligibility for the library's daily guessing games."""

from __future__ import annotations

import math


POPULARITY_PERCENTILE = 0.75


def popular_daily_pool(
    rows: list[dict],
    light: dict[str, dict],
    percentile: float = POPULARITY_PERCENTILE,
) -> tuple[list[tuple[dict, dict]], int]:
    """Owned/finished games in the upper popularity quartile, plus the vote cutoff.

    Popularity is IGDB's community rating count. The percentile is calculated over
    distinct IGDB games so owning the same game on several platforms cannot move the
    threshold. Rows without a community rating or usable cover cannot be answers.
    """
    eligible = []
    counts_by_game = {}
    for row in rows:
        if not (row.get("owned") or row.get("completed")):
            continue
        meta = light.get(row.get("_k")) or {}
        if not meta.get("cover") or not meta.get("igdbId"):
            continue
        try:
            votes = int(meta.get("userRatingCount") or 0)
        except (TypeError, ValueError):
            votes = 0
        if votes <= 0:
            continue
        eligible.append((row, meta, votes))
        game_id = str(meta["igdbId"])
        counts_by_game[game_id] = max(votes, counts_by_game.get(game_id, 0))

    counts = sorted(counts_by_game.values())
    if not counts:
        return [], 0
    rank = max(1, math.ceil(len(counts) * percentile))
    cutoff = counts[min(rank, len(counts)) - 1]
    return [(row, meta) for row, meta, votes in eligible if votes >= cutoff], cutoff
