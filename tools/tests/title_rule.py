#!/usr/bin/env python3
"""PYTHONPATH=src python tools/tests/title_rule.py (app dependencies).

Two titles that share a subtitle are usually one game under two names, and the
separator rule in MatchValidator.titles_equal_fuzzy exists to say so. It used to
say so for ANY shared half, so a shared edition descriptor was enough: Metacritic
served Zelda: Tears of the Kingdom's score for "Hades II - Nintendo Switch 2
Edition", and Ghost of Tsushima's for "Raiden V: Director's Cut".
"""
import json
import unittest

from enrich import Enricher
from match_validator import MatchValidator


class SharedSubtitleTest(unittest.TestCase):
    def setUp(self):
        self.v = MatchValidator()

    def test_a_shared_edition_is_not_a_shared_game(self):
        for a, b in [
            ("Hades II - Nintendo Switch 2 Edition",
             "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch 2 Edition"),
            ("Raiden V: Director's Cut", "Ghost of Tsushima: Director's Cut"),
            ("Age of Empires II: Definitive Edition", "Age of Mythology: Definitive Edition"),
            ("ExZeus: The Complete Collection", "Steve Jackson's Sorcery!: The Complete Collection"),
            ("Night Slashers: Remake", "THE HOUSE OF THE DEAD 2: Remake"),
        ]:
            self.assertFalse(self.v.titles_equal_fuzzy(a, b), (a, b))
            self.assertTrue(self.v.shares_only_an_edition(a, b), (a, b))

    def test_a_shared_subtitle_still_matches_a_translation(self):
        for a, b in [
            ("Tengai Makyō: Ziria", "Far East of Eden: Ziria"),
            ("Eiyū Densetsu: Ao no Kiseki", "The Legend of Heroes: Ao no Kiseki"),
            ("Metal Max 4: Gekkō no Diva", "Metal Max 4: Moonlight Diva"),
            ("Memoria", "The Dark Eye: Memoria"),
        ]:
            self.assertTrue(self.v.titles_equal_fuzzy(a, b), (a, b))
            self.assertFalse(self.v.shares_only_an_edition(a, b), (a, b))

    def test_an_edition_still_matches_when_the_rest_of_the_title_agrees(self):
        self.assertTrue(self.v.titles_equal_fuzzy(
            "Pokémon Yellow: Special Pikachu Edition",
            "Pokémon Yellow Version: Special Pikachu Edition"))

    def test_version_names_a_game_not_a_release(self):
        """"Red Version" and "Veedramon Version" are what the games are called."""
        self.assertFalse(self.v.is_edition_descriptor("Veedramon Version"))
        self.assertTrue(self.v.titles_equal_fuzzy(
            "Digimon Anode/Cathode Tamer: Veedramon Version",
            "Digimon Anode Tamer/Cathode Tamer: Veedramon Version"))


class PurgeTest(unittest.TestCase):
    def setUp(self):
        self.e = Enricher(None, ":memory:", secondary={"metacritic": None})
        self.addCleanup(self.e._db.close)
        self.e._key_meta = {
            "hades": {"title": "Hades II - Nintendo Switch 2 Edition"},
            "ori": {"title": "Ori and the Blind Forest: Definitive Edition"},
            "pinned": {"title": "Raiden V: Director's Cut"},
        }
        rows = [
            ("hades", "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch 2 Edition", 0),
            ("ori", "Ori and the Blind Forest: Definitive Edition", 0),
            ("pinned", "Ghost of Tsushima: Director's Cut", 1),
        ]
        self.e._db.executemany(
            "INSERT INTO metacritic(match_key,status,data,manual) VALUES(?,'matched',?,?)",
            [(k, json.dumps({"name": n}), m) for k, n, m in rows])

    def keys(self):
        return {k for (k,) in self.e._db.execute("SELECT match_key FROM metacritic")}

    def test_purges_only_the_refused_match_and_only_once(self):
        self.e.purge_refused_matches()
        self.assertEqual(self.keys(), {"ori", "pinned"})   # a hand pin is a decision
        self.e._db.execute(
            "INSERT INTO metacritic(match_key,status,data,manual) VALUES('hades','matched',?,0)",
            (json.dumps({"name": "The Legend of Zelda: Tears of the Kingdom - Nintendo Switch 2 Edition"}),))
        self.e.purge_refused_matches()                       # stamped: a no-op from here on
        self.assertIn("hades", self.keys())


if __name__ == "__main__":
    unittest.main()
