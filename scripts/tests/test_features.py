"""Tests for lib_features.py: milestone gates, needs, owned-path overlap, protected files."""
import os, sys, unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import lib_features as lf  # noqa: E402


def feat(fid, ms, status="todo", kind="feature", deps=(), prio=1, **kw):
    return {"id": fid, "milestone": ms, "status": status, "kind": kind, "depends_on": list(deps), "priority": prio, **kw}


class Gates(unittest.TestCase):
    def data(self):
        return {"milestones": ["M0", "M0.5", "M1"], "gates": {}, "features": [
            feat("F-010", "M0", "done", prio=1, try_="x"),
            feat("F-001", "M0", "todo", kind="spike", prio=2),
            feat("F-015", "M0.5", "todo", deps=["F-010"], prio=3, paths=["crates/harness/**"]),
            feat("F-030", "M1", "todo", deps=["F-015"], prio=4),
        ]}

    def test_spike_does_not_hold_gate_and_gate_blocks_next_milestone(self):
        d = self.data()
        self.assertEqual(lf.open_gate(d), "M0")
        self.assertEqual([f["id"] for f in lf.ready(d)], ["F-001"])
        d["gates"]["M0"] = {"passed": "2026-10-24"}
        self.assertIsNone(lf.open_gate(d))
        self.assertEqual([f["id"] for f in lf.ready(d)], ["F-001", "F-015"])

    def test_live_keys_need(self):
        f = feat("F-002", "M0", kind="spike", needs=["live-keys"])
        os.environ["LECTER_KEYS_FILE"] = "/nonexistent/keys.env"
        try:
            self.assertEqual(lf.unmet_needs(f), ["live-keys"])
            os.environ["LECTER_KEYS_FILE"] = __file__
            self.assertEqual(lf.unmet_needs(f), [])
        finally:
            del os.environ["LECTER_KEYS_FILE"]


class Paths(unittest.TestCase):
    def test_overlap(self):
        self.assertTrue(lf.globs_overlap("crates/core/**", "crates/core/src/journal.rs"))
        self.assertTrue(lf.globs_overlap("crates/**", "crates/index/**"))
        self.assertFalse(lf.globs_overlap("crates/core/**", "crates/index/**"))
        self.assertFalse(lf.globs_overlap("Cargo.lock", "Cargo.lock"))
        self.assertFalse(lf.globs_overlap("ui/src/editor/**", "ui/src/settings/**"))

    def test_parallel_safe(self):
        d = {"milestones": ["M1"], "gates": {}, "features": [
            feat("F-030", "M1", "in_progress", paths=["ui/src/editor/**"]),
            feat("F-031", "M1", paths=["ui/src/editor/vim.ts"], prio=2),
            feat("F-032", "M1", paths=["crates/index/**"], prio=3),
        ]}
        self.assertEqual([f["id"] for f in lf.parallel_safe(d, ["F-030"])], ["F-032"])

    def test_protected_allowed(self):
        d = {"features": [feat("F-025", "M0.5", "in_progress", protected=["tests/perf/budgets.json"]),
                          feat("F-030", "M1", "todo", protected=["deny.toml"])]}
        self.assertTrue(lf.protected_allowed(d, "tests/perf/budgets.json"))
        self.assertFalse(lf.protected_allowed(d, "deny.toml"))


class RealPlan(unittest.TestCase):
    def test_kit_plan_is_consistent(self):
        d = lf.load()
        ids = lf.by_id(d)
        for f in d["features"]:
            for dep in f["depends_on"]:
                self.assertIn(dep, ids, f["id"])
            self.assertTrue(f.get("paths") or f["kind"] == "spike" or f["id"] == "F-010", f["id"])
        self.assertIsNone(lf.open_gate(d))


if __name__ == "__main__":
    unittest.main()
