"""Tests for check_sec_ids.py (every SEC/ROB requirement has a card) and add_dep.py's package age check (SEC-54)."""
import datetime, json, shutil, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import add_dep, check_sec_ids  # noqa: E402


class SecIds(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="lecter-secids-"))
        (self.root / "docs" / "spec").mkdir(parents=True)
        (self.root / "docs" / "spec" / "13-security.md").write_text(
            "- **SEC-10 A.** x\n- **SEC-11 B.** x\n- **SEC-12 C.** x\n- **SEC-15 Live.** x\n")
        (self.root / "docs" / "spec" / "17-robustness.md").write_text("- **ROB-50** x\n")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def features(self, *crit):
        cards = [{"id": f"F-{i:03d}", "title": "t", "acceptance": [c]} for i, c in enumerate(crit, 1)]
        (self.root / "docs" / "features.json").write_text(json.dumps({"features": cards}))

    def run_check(self):
        with mock.patch.object(check_sec_ids, "KIT_ONLY", {"SEC-15": "scripts/live.sh"}), \
             mock.patch.object(check_sec_ids, "COVERED_BY", {}):
            return check_sec_ids.check(self.root)

    def test_uncited_requirement_fails(self):
        self.features("does A (SEC-10)", "logs rotate (ROB-50)")
        (self.root / "scripts").mkdir(); (self.root / "scripts" / "live.sh").write_text("")
        self.assertEqual([p.split(":")[0] for p in self.run_check()], ["SEC-11", "SEC-12"])

    def test_range_counts_for_every_id_in_it(self):
        self.features("limits (SEC-10 to SEC-12)", "ROB-50")
        (self.root / "scripts").mkdir(); (self.root / "scripts" / "live.sh").write_text("")
        self.assertEqual(self.run_check(), [])

    def test_kit_only_needs_the_file(self):
        self.features("SEC-10 to SEC-12", "ROB-50")
        self.assertEqual([p.split(":")[0] for p in self.run_check()], ["SEC-15"])

    def test_real_kit_is_covered(self):
        self.assertEqual(check_sec_ids.check(KIT), [])


class Freshness(unittest.TestCase):
    NOW = datetime.datetime(2026, 10, 25, tzinfo=datetime.timezone.utc)

    def test_new_crate_is_stopped(self):
        r = add_dep.freshness_reasons("rust", "2026-09-01T00:00:00Z", 50_000, now=self.NOW)
        self.assertEqual(len(r), 1)
        self.assertIn("54 days", r[0])

    def test_barely_downloaded_npm_package_is_stopped(self):
        r = add_dep.freshness_reasons("ui", "2020-01-01T00:00:00.000Z", 999, now=self.NOW)
        self.assertEqual(r, ["999 downloads last week (under 1,000)"])

    def test_limits_are_inclusive_at_the_threshold(self):
        self.assertEqual(add_dep.freshness_reasons("rust", "2026-07-27T00:00:00Z", 10_000, now=self.NOW), [])

    def test_unknown_name_fails_closed(self):
        with mock.patch.object(add_dep, "registry_facts", side_effect=OSError("HTTP Error 404")):
            self.assertEqual(add_dep.check_fresh("rust", "serde-jsonx-fast", None), 4)

    def test_established_package_passes(self):
        with mock.patch.object(add_dep, "registry_facts", return_value=("2014-12-05T20:20:39Z", 1_500_000_000)):
            self.assertEqual(add_dep.check_fresh("rust", "serde", None), 0)

    def test_maintainer_approval_skips_the_lookup(self):
        with mock.patch.object(add_dep, "maintainer_decision", return_value=True), \
             mock.patch.object(add_dep, "registry_facts", side_effect=AssertionError("looked up")):
            self.assertEqual(add_dep.check_fresh("rust", "brand-new", "D-070"), 0)


if __name__ == "__main__":
    unittest.main()
