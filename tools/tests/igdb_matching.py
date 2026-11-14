#!/usr/bin/env python3
"""PYTHONPATH=src python tools/tests/igdb_matching.py (app dependencies).

Guards the diacritic path through IgdbClient.match(). The regression it exists for:
every query was romanised before it was sent, so `search "Oukami"` went out for
"Ōkami" and came back empty, and 65 titles on the sheet — nearly all of them macron
romanisations of Japanese names — fell through to IGN for their metadata.
"""
import unittest
from unittest.mock import patch

from igdb import IgdbClient, _fold, _romanize, _substring_probes


class QueryBuildingTest(unittest.TestCase):
    def setUp(self):
        self.cl = IgdbClient("id", "secret")

    def test_ascii_title_still_costs_one_query(self):
        """The 96% case must not pay for the diacritic repair."""
        self.assertEqual(
            self.cl._search_queries("Super Mario Odyssey"), ["Super Mario Odyssey"])
        self.assertEqual(_substring_probes("Super Mario Odyssey"), [])

    def test_title_is_searched_as_written_first(self):
        """IGDB stores "Einhänder" and "Brütal Legend" with their diacritics."""
        self.assertEqual(self.cl._search_queries("Einhänder")[0], "Einhänder")

    def test_both_long_vowel_romanisations_are_tried(self):
        queries = self.cl._search_queries("Ōkami")
        self.assertEqual(queries, ["Ōkami", "Okami", "Oukami", "Ookami"])

    def test_long_vowels(self):
        self.assertEqual(_romanize("Chō Jikū Yōsai", "u"), "Chou Jikuu Yousai")
        self.assertEqual(_romanize("Ōsōji", "o"), "Oosooji")
        self.assertEqual(_fold("Götzendiener"), "Gotzendiener")

    def test_probes_split_on_punctuation_sources_disagree_about(self):
        """IGDB drops the sheet's colon in "Senran Kagura: Bon Appétit!"."""
        self.assertEqual(
            _substring_probes("Senran Kagura: Bon Appétit!"),
            ["Senran Kagura", "Bon App"])

    def test_probes_are_ordered_by_position_not_length(self):
        """A title's head identifies it; its tail is boilerplate thousands share."""
        self.assertEqual(
            _substring_probes("Pokémon Legends: Z-A - Nintendo Switch 2 Edition"),
            ["mon Legends", "Nintendo Switch 2 Edition"])

    def test_probe_keeps_apostrophes(self):
        self.assertEqual(
            _substring_probes("Drift King Shutokō Battle '94"),
            ["Drift King Shutok", "Battle '94"])


class EscalationTest(unittest.TestCase):
    """match() must stop at the first query that yields something acceptable."""

    def setUp(self):
        self.cl = IgdbClient("id", "secret")
        self.bodies = []

    def _run(self, title, responses, **kwargs):
        def fake_post(route, body):
            self.bodies.append(body)
            return responses.pop(0) if responses else []
        with patch.object(self.cl, "_post", side_effect=fake_post), \
                patch.object(self.cl, "_age_of", return_value=None):
            return self.cl.match(title, **kwargs)

    @staticmethod
    def _hit(name, platform):
        return [{"id": 1, "name": name, "platforms": [{"name": platform}]}]

    def test_first_hit_wins_and_no_further_query_is_sent(self):
        enrichment, score = self._run(
            "Ōkami HD", [self._hit("Ōkami HD", "PlayStation 4")],
            platform="PlayStation 4")
        self.assertEqual(enrichment["name"], "Ōkami HD")
        self.assertTrue(score)
        self.assertEqual(len(self.bodies), 1)
        self.assertIn('search "Ōkami HD"', self.bodies[0])

    def test_empty_search_escalates_to_a_substring_probe(self):
        # Four searches come back empty, as they do for a name IGDB never indexed.
        enrichment, _ = self._run(
            "Chō Jikū Yōsai Macross",
            [[], [], [], [], self._hit("Choujikuu Yousai Macross", "Nintendo Entertainment System")],
            platform="NES")
        self.assertEqual(enrichment["name"], "Choujikuu Yousai Macross")
        self.assertEqual(len(self.bodies), 5)
        self.assertIn('where name ~ *"sai macross"*', self.bodies[-1])

    def test_unacceptable_candidates_do_not_stop_the_escalation(self):
        enrichment, _ = self._run(
            "Tengai Makyō II: Manji Maru",
            [self._hit("Some Other Game", "TurboGrafx-CD"),
             [],
             self._hit("Far East of Eden II: Manji-maru", "TurboGrafx-CD")],
            platform="TurboGrafx-CD")
        self.assertEqual(enrichment["name"], "Far East of Eden II: Manji-maru")

    def test_nothing_anywhere_is_still_a_clean_miss(self):
        enrichment, score = self._run("Jiāngshī lièrén", [], platform="Monon Color")
        self.assertIsNone(enrichment)
        self.assertEqual(score, 0)

    def test_a_probe_will_not_take_a_platformless_stub(self):
        """"Ring ∞" fuzzy-matches a visual novel called "Rings" that lists nothing."""
        enrichment, _ = self._run(
            "Ring ∞", [[], [], [{"id": 9, "name": "Rings"}]], platform="NEC PC-9801")
        self.assertIsNone(enrichment)

    def test_a_probe_takes_an_exact_title_whatever_the_platform_says(self):
        """IGDB files this one under a platform the sheet does not agree with."""
        enrichment, _ = self._run(
            "Chō Jikū Yōsai Macross: Skull Leader Complete Pack",
            [[], [], [], [], self._hit(
                "Choujikuu Yousai Macross: Skull Leader Complete Pack", "Sharp X68000")],
            platform="NEC PC-9801")
        self.assertEqual(
            enrichment["name"], "Choujikuu Yousai Macross: Skull Leader Complete Pack")

    def test_a_search_still_takes_a_platformless_candidate(self):
        """Unchanged for the search path: a title-only hit is evidence enough there."""
        enrichment, _ = self._run(
            "Ōkami", [[{"id": 9, "name": "Okami"}]], platform="PlayStation 2")
        self.assertEqual(enrichment["name"], "Okami")


if __name__ == "__main__":
    unittest.main()
