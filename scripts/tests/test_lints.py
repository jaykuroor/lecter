"""Tests for check_arch.py, check_deps.py and check_size.py."""
import shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import check_arch, check_deps, check_size  # noqa: E402

WS = """[workspace]
members = ["crates/*", "app"]
[workspace.lints.clippy]
unwrap_used = "deny"
expect_used = "deny"
[workspace.dependencies]
lecter-parse = { path = "crates/parse", default-features = false }
"""
CLIPPY = 'disallowed-methods = [{ path = "std::thread::sleep", reason = "blocks the async runtime" }]\n'


def crate(name, deps=""):
    return f'[package]\nname = "lecter-{name}"\nversion = "0.1.0"\n[lints]\nworkspace = true\n[dependencies]\n{deps}'


def lock(*pkgs):
    out = "version = 4\n"
    for name, deps in pkgs:
        out += f'\n[[package]]\nname = "{name}"\nversion = "1.0.0"\n'
        if deps:
            out += "dependencies = [" + ", ".join(f'"{d}"' for d in deps) + "]\n"
    return out


class Repo(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="lecter-lints-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def git(self, *a):
        r = subprocess.run(["git", *a], cwd=self.root, capture_output=True, text=True)
        if r.returncode:
            raise AssertionError(f"git {a} failed ({r.returncode}): {r.stderr.strip()}")
        return r.stdout

    def init_git(self):
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "user.name", "t")
        self.git("config", "commit.gpgsign", "false")  # hermetic: no signing agent in the sandbox

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-qm", msg)
        return self.git("rev-parse", "HEAD").strip()


class Arch(Repo):
    def base(self):
        self.write("Cargo.toml", WS)
        self.write("clippy.toml", CLIPPY)
        self.write("crates/core/Cargo.toml", crate("core", 'lecter-parse = { workspace = true, features = ["proto"] }\n'))
        self.write("crates/ai/Cargo.toml", crate("ai", 'lecter-core = { path = "../core" }\n'))
        self.write("crates/parse/Cargo.toml", crate("parse"))

    def test_no_workspace_yet_passes(self):
        self.assertEqual(check_arch.check(self.root)[0], [])

    def test_allowed_graph_passes(self):
        self.base()
        self.assertEqual(check_arch.check(self.root)[0], [])

    def test_forbidden_edge_fails(self):
        self.base()
        self.write("crates/core/Cargo.toml", crate("core", 'lecter-ai = { path = "../ai" }\n'))
        probs = check_arch.check(self.root)[0]
        self.assertTrue(any("lecter-core → lecter-ai" in p for p in probs), probs)

    def test_parse_without_proto_only_fails(self):
        self.base()
        self.write("crates/core/Cargo.toml", crate("core", 'lecter-parse = { path = "../parse" }\n'))
        self.assertTrue(any("proto" in p for p in check_arch.check(self.root)[0]))

    def test_missing_lints_fail(self):
        self.base()
        self.write("Cargo.toml", WS.replace('unwrap_used = "deny"\n', ""))
        self.write("crates/ai/Cargo.toml", crate("ai").replace("[lints]\nworkspace = true\n", ""))
        (self.root / "clippy.toml").unlink()
        probs = " ".join(check_arch.check(self.root)[0])
        for want in ("unwrap_used", "[lints] workspace = true", "clippy.toml"):
            self.assertIn(want, probs)


class Deps(Repo):
    def setUp(self):
        super().setUp()
        self.init_git()
        self.write("Cargo.toml", WS)
        self.write("crates/core/Cargo.toml", crate("core", 'serde = "1"\n'))
        self.write("Cargo.lock", lock(("lecter-core", ["serde"]), ("serde", [])))
        self.write("ui/package.json", '{"dependencies": {"solid-js": "1.9.0"}}')
        self.write("docs/DECISIONS.md", "# Decisions\n\n## D-050 · Approve ort\n2026-10-24 · Jay · active\n")
        self.base = self.commit("base")
        self.git("switch", "-q", "-c", "feat/F-099-x")

    def probs(self):
        return check_deps.check(self.root, self.base)

    def test_unchanged_passes(self):
        self.assertEqual(self.probs(), [])

    def test_new_direct_dep_needs_trailer(self):
        self.write("crates/core/Cargo.toml", crate("core", 'serde = "1"\nsmallvec = "1"\n'))
        self.write("Cargo.lock", lock(("lecter-core", ["serde", "smallvec"]), ("serde", []), ("smallvec", [])))
        self.commit("F-099: add smallvec")
        self.assertTrue(any("smallvec" in p for p in self.probs()))
        self.commit_allow_empty("F-099: note\n\nDep-Added: smallvec - MIT/Apache-2.0, 1 crate, inline vectors")
        self.assertEqual(self.probs(), [])

    def commit_allow_empty(self, msg):
        self.git("commit", "-q", "--allow-empty", "-m", msg)

    def test_native_crate_needs_jay(self):
        self.write("crates/core/Cargo.toml", crate("core", 'serde = "1"\nort = "2"\n'))
        self.write("Cargo.lock", lock(("lecter-core", ["serde", "ort"]), ("serde", []), ("ort", ["ort-sys"]), ("ort-sys", ["cc"]), ("cc", [])))
        self.commit("F-099: add ort\n\nDep-Added: ort - MIT, 3 crates, local model")
        probs = self.probs()
        self.assertTrue(any("ort" in p and "native" in p for p in probs), probs)
        self.commit_allow_empty("F-099: approved\n\nDeps-Approved: D-050")
        self.assertEqual(self.probs(), [])

    def test_preapproved_native_passes(self):
        self.write("scripts/deps_preapproved.txt", "libsqlite3-sys\n")
        self.write("crates/core/Cargo.toml", crate("core", 'serde = "1"\nrusqlite = "0.32"\n'))
        self.write("Cargo.lock", lock(("lecter-core", ["serde", "rusqlite"]), ("serde", []), ("rusqlite", ["libsqlite3-sys"]), ("libsqlite3-sys", ["cc"]), ("cc", [])))
        self.commit("F-099: sqlite\n\nDep-Added: rusqlite - MIT, 3 crates, state.db")
        self.assertEqual(self.probs(), [])

    def test_too_many_crates_needs_jay(self):
        many = [(f"c{i}", []) for i in range(31)]
        self.write("crates/core/Cargo.toml", crate("core", 'serde = "1"\nbig = "1"\n'))
        self.write("Cargo.lock", lock(("lecter-core", ["serde", "big"]), ("serde", []), ("big", [n for n, _ in many]), *many))
        self.commit("F-099: big\n\nDep-Added: big - MIT, 32 crates, x")
        self.assertTrue(any("new crates" in p for p in self.probs()))

    def test_large_ui_package_needs_jay(self):
        self.write("ui/package.json", '{"dependencies": {"solid-js": "1.9.0", "huge": "1.0.0"}}')
        self.commit("F-099: huge\n\nDep-Added: huge - MIT, gz=180KB, charts")
        self.assertTrue(any("KB gz" in p for p in self.probs()))


class Size(Repo):
    def test_limits(self):
        self.write("crates/core/src/lib.rs", "x\n" * 501)
        self.write("crates/core/src/ok.rs", "x\n" * 500)
        self.write("ui/src/core/bindings.ts", "x\n" * 2000)
        self.write("docs/spec/01-x.md", "x\n" * 301)
        self.write("AGENTS.md", "x\n" * 120)
        self.write("CLAUDE.md", "x\n" * 31)
        probs = " ".join(check_size.check(self.root))
        self.assertIn("lib.rs", probs)
        self.assertNotIn("ok.rs", probs)
        self.assertNotIn("bindings.ts", probs)
        self.assertIn("01-x.md", probs)
        self.assertIn("AGENTS.md + CLAUDE.md: 151", probs)


if __name__ == "__main__":
    unittest.main()
