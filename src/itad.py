"""IsThereAnyDeal: what a wishlisted game costs right now, and its lowest ever.

The Steam wishlist knows what you want; ITAD knows what it costs — the current
price, the regular price it's cut from, and the all-time historical low that
tells you whether "on sale" actually means anything. That's the whole point of
a wishlist you can sort by deal.

Two calls, both keyed off the Steam appid a wishlist entry already carries:

  * lookup (GET /games/lookup/v1?appid=) — resolve a Steam appid to ITAD's own
    game id (a UUID). One per appid, but the id never changes, so it's cached
    for good once resolved.
  * prices (POST /games/prices/v3, body [ids]) — a BATCH: for each id, the
    all-time low (historyLow.all) and every current store deal (shop, price,
    regular, cut%). We keep the Steam deal for the card and the low for the
    "lowest ever" signal.

The key is a service-wide ITAD API key (env ITAD_API_KEY), like the IGDB and
GameSpot keys — not a per-account credential. The limit is a comfortable
1000 requests / 5 minutes, so the only pacing that matters is batching the
price call, which the API does for us.
"""

from __future__ import annotations

import logging

import requests

log = logging.getLogger("gamedex.itad")

BASE = "https://api.isthereanydeal.com"
STEAM_SHOP_ID = 61                      # ITAD's shop id for Steam


class ItadClient:
    def __init__(self, api_key: str, country: str = "US", client_id: str = ""):
        # The price endpoints authenticate with the app's API KEY (the plain
        # "Key" on the ITAD app page), which is distinct from the OAuth
        # clientId/clientSecret. Accept the clientId as a fallback in case an app
        # only surfaces that — the worst case is a 401 we log, not a crash.
        self._key = (api_key or "").strip() or (client_id or "").strip()
        self._country = country
        self._auth_warned = False

    @property
    def configured(self) -> bool:
        return bool(self._key)

    def _check_auth(self, r):
        if r.status_code in (401, 403) and not self._auth_warned:
            self._auth_warned = True
            log.warning("ITAD rejected the credential (%s) — the price endpoints "
                        "want the plain API KEY from isthereanydeal.com/apps/my/, "
                        "not the OAuth clientId/secret", r.status_code)

    def _get(self, path, params=None, timeout=20):
        params = dict(params or {}); params["key"] = self._key
        r = requests.get(f"{BASE}{path}", params=params, timeout=timeout)
        self._check_auth(r)
        r.raise_for_status()
        return r.json()

    def _post(self, path, body, params=None, timeout=25):
        params = dict(params or {}); params["key"] = self._key
        r = requests.post(f"{BASE}{path}", params=params, json=body, timeout=timeout)
        self._check_auth(r)
        r.raise_for_status()
        return r.json()

    # ---- appid -> ITAD game id ------------------------------------------------
    def lookup_appid(self, appid) -> str | None:
        try:
            j = self._get("/games/lookup/v1", {"appid": int(appid)})
        except Exception as exc:
            log.debug("itad lookup %s: %s", appid, exc)
            return None
        if j.get("found") and (j.get("game") or {}).get("id"):
            return j["game"]["id"]
        return None

    # ---- prices (batched) -----------------------------------------------------
    def prices(self, itad_ids: list[str]) -> dict:
        """{itad_id: {current, regular, cut, currency, url, low, atLow}} — the
        Steam deal plus the all-time low. `atLow` is True when today's price is
        at (or below) the historical low, which is what the "lowest ever" facet
        keys off."""
        out: dict = {}
        ids = [i for i in itad_ids if i]
        for i in range(0, len(ids), 200):
            chunk = ids[i:i + 200]
            try:
                rows = self._post("/games/prices/v3", chunk, {"country": self._country})
            except Exception as exc:
                log.debug("itad prices chunk failed: %s", exc)
                continue
            for row in rows or []:
                gid = row.get("id")
                if not gid:
                    continue
                low = ((row.get("historyLow") or {}).get("all") or {}).get("amount")
                deals = row.get("deals") or []
                steam = next((d for d in deals
                              if (d.get("shop") or {}).get("id") == STEAM_SHOP_ID), None)
                deal = steam or (deals[0] if deals else None)
                if deal is None:
                    out[gid] = {"low": low, "currency": None, "current": None,
                                "regular": None, "cut": 0, "url": None, "atLow": False}
                    continue
                cur = (deal.get("price") or {}).get("amount")
                reg = (deal.get("regular") or {}).get("amount")
                currency = (deal.get("price") or {}).get("currency")
                out[gid] = {
                    "current": cur, "regular": reg, "cut": deal.get("cut") or 0,
                    "currency": currency, "url": deal.get("url"),
                    "shop": (deal.get("shop") or {}).get("name"),
                    "low": low,
                    # A tiny epsilon so a rounding cent doesn't hide a real match.
                    "atLow": bool(cur is not None and low is not None and cur <= low + 0.01),
                }
        return out
