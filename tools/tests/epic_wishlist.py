#!/usr/bin/env python3
"""PYTHONPATH=src python tools/tests/epic_wishlist.py (app dependencies)."""
import unittest
from unittest.mock import Mock, patch

from epic_user import EpicUserClient, WISHLIST
from platformdb import PlatformDB
from platform_sync import PlatformSync


def entry(offer="offer-1"):
    return {"id": "wish-" + offer, "offerId": offer, "sandboxId": "namespace"}


def response(items, total=None, start=0):
    return {"data": items, "paging": {"start": start, "count": 50,
                                      "total": len(items) if total is None else total}}


class EpicWishlistTest(unittest.TestCase):
    def setUp(self):
        self.client = EpicUserClient()
        self.client._limiter = Mock()
        self.client._token = Mock(return_value="private-token")
        self.client._get = Mock(return_value={"offer-1": {"title": "First"},
                                              "offer-2": {"title": "Second"}})
        self.session_patch = patch("epic_user.browser_requests.Session")
        self.session_factory = self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.session = self.session_factory.return_value.__enter__.return_value
        self.session.get.return_value.json.return_value = response([entry()])

    def test_current_api_and_catalog_titles(self):
        result = self.client.fetch_wishlist({})
        self.assertEqual(result, [{"appId": "offer-1", "name": "First", "addedAt": None,
                                   "extra": {"namespace": "namespace"}}])
        args, kw = self.session.get.call_args
        self.assertEqual(args[0], WISHLIST)
        self.assertEqual(kw["headers"]["Authorization"], "Bearer private-token")
        self.assertFalse(kw["allow_redirects"])
        self.session_factory.assert_called_once_with(impersonate="chrome")
        self.assertTrue(self.session_factory.return_value.__exit__.called)

    def test_complete_empty_snapshot(self):
        self.session.get.return_value.json.return_value = response([])
        self.assertEqual(self.client.fetch_wishlist({}), [])
        self.client._get.assert_not_called()

    def test_pagination_collects_all_before_returning(self):
        self.session.get.return_value.json.side_effect = [
            response([entry()], total=2), response([entry("offer-2")], total=2, start=1)]
        self.assertEqual(len(self.client.fetch_wishlist({})), 2)
        self.assertEqual(self.session.get.call_args.kwargs["params"]["start"], 1)

    def test_invalid_or_partial_snapshots_raise(self):
        cases = [None, {}, {"errors": [{"message": "private-token"}]},
                 {"data": [], "paging": {}}, response([], total=2),
                 response([entry()], total=0), response([entry()], start=9),
                 response([entry(), entry()]), response([{}]),
                 response([{"offerId": "x", "sandboxId": None}])]
        for payload in cases:
            with self.subTest(payload=payload):
                self.session.get.return_value.json.return_value = payload
                with self.assertRaisesRegex(RuntimeError, "cached wishlist retained"):
                    self.client.fetch_wishlist({})

    def test_ignored_pagination_does_not_truncate(self):
        self.session.get.return_value.json.return_value = response([entry()], total=2)
        with self.assertRaises(RuntimeError):
            self.client.fetch_wishlist({})

    def test_changed_total_does_not_truncate(self):
        self.session.get.return_value.json.side_effect = [
            response([entry()], total=2), response([entry("offer-2")], total=3, start=1)]
        with self.assertRaises(RuntimeError):
            self.client.fetch_wishlist({})

    def test_http_failure_is_sanitized(self):
        self.session.get.return_value.raise_for_status.side_effect = ValueError("private-token")
        with self.assertRaises(RuntimeError) as exc:
            self.client.fetch_wishlist({})
        self.assertNotIn("private-token", str(exc.exception))

    def test_invalid_json_is_not_empty(self):
        self.session.get.return_value.json.side_effect = ValueError("invalid json")
        with self.assertRaises(RuntimeError):
            self.client.fetch_wishlist({})

    def test_catalog_failure_is_not_partial_success(self):
        self.client._get.side_effect = ValueError("catalog unavailable")
        with self.assertRaises(RuntimeError):
            self.client.fetch_wishlist({})

    def test_missing_title_is_not_partial_success(self):
        self.client._get.return_value = {"offer-1": {"title": None}}
        with self.assertRaises(RuntimeError):
            self.client.fetch_wishlist({})

    def test_sync_failure_preserves_cache_and_reports_stage_error(self):
        db = PlatformDB(":memory:")
        self.addCleanup(db._db.close)
        db.link("epic", {}, "test-account")
        db.replace_wishlist("epic", [{"appId": "old", "name": "Cached game"}])
        db.kv_set("match_stamp:epic", "stable")
        sync = PlatformSync.__new__(PlatformSync)
        sync._db, sync._busy = db, {}
        sync._match_stamp = Mock(return_value="stable")
        sync._match_wishlist = Mock()
        for method, value in [("_sync_library", []), ("_sync_screenshots", 0),
                              ("_sync_reviews", 0), ("_price_wishlist", None),
                              ("_sync_achievements", 0)]:
            setattr(sync, method, Mock(return_value=value))
        # A later page failing must not replace the cached snapshot with page 1.
        good = Mock()
        good.json.return_value = response([entry()], total=2)
        self.session.get.side_effect = [good, TimeoutError("private-token")]
        counts = sync.sync_account(db.account("epic"), self.client)
        self.assertIsNone(counts["wishlist"])
        self.assertEqual(db._db.execute("SELECT app_id,name FROM wishlist").fetchall(),
                         [("old", "Cached game")])
        account = db.account("epic")
        self.assertEqual(account["status"], "error")
        self.assertIn("wishlist:", account["error"])
        self.assertNotIn("private-token", account["error"])
        sync._match_wishlist.assert_not_called()
        sync._sync_reviews.assert_called_once()


if __name__ == "__main__":
    unittest.main()
