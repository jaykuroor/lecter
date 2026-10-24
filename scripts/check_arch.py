#!/usr/bin/env python3
"""Architecture lint (docs/spec/01-architecture.md#repository-layout).

  python3 scripts/check_arch.py [--root DIR]

Fails on:
  - a dependency between Lecter crates that the allowed-edges table doesn't list;
  - core or app depending on parse/models with more than their `proto` feature;
  - workspace lints missing: clippy unwrap_used and expect_used = "deny" (tests may allow them),
    and every member crate opting in with [lints] workspace = true;
  - clippy.toml without disallowed-methods for blocking calls (std::thread::sleep,
    std::fs::read_to_string are fine in tests but never in async core code).
Passes with a note before the Rust workspace exists (F-010).
"""
import argparse, sys, tomllib
from pathlib import Path

# crate folder → crates it may depend on. Keep in sync with the table in 01-architecture.md.
ALLOWED = {
    "core": {"parse", "models"},
    "index": {"core"},
    "ai": {"core", "index", "cas"},
    "app": {"core", "ai", "index", "parse"},
    "harness": {"core", "ai", "index", "parse"},
    "parse": set(), "models": set(), "cas": set(),
    "cli": {"core", "ai", "index"},
    "fake-provider": set(),
}
PROTO_ONLY = {("core", "parse"), ("core", "models"), ("app", "parse")}
REQUIRED_DISALLOWED = {"std::thread::sleep"}


def short(name):
    return name[len("lecter-"):] if name.startswith("lecter-") else None


def member_dirs(root, ws):
    out = []
    for pat in ws.get("workspace", {}).get("members", []):
        out += [p for p in sorted(root.glob(pat)) if (p / "Cargo.toml").exists()]
    return out


def deps_of(manifest, ws_deps):
    out = {}
    for key in ("dependencies", "build-dependencies"):  # dev-dependencies may reach further (test helpers)
        for name, spec in manifest.get(key, {}).items():
            spec = spec if isinstance(spec, dict) else {"version": spec}
            real = spec.get("package", name)
            if spec.get("workspace"):
                base = ws_deps.get(name, {})
                base = base if isinstance(base, dict) else {}
                real = base.get("package", real)
                spec = {**base, **spec}
            out[real] = spec
    return out


def check(root):
    ws_file = root / "Cargo.toml"
    if not ws_file.exists():
        return [], "no Cargo.toml yet (F-010)"
    ws = tomllib.loads(ws_file.read_text(encoding="utf-8"))
    ws_deps = ws.get("workspace", {}).get("dependencies", {})
    problems = []
    lints = ws.get("workspace", {}).get("lints", {}).get("clippy", {})
    for lint in ("unwrap_used", "expect_used"):
        level = lints.get(lint)
        level = level.get("level") if isinstance(level, dict) else level
        if level not in ("deny", "forbid"):
            problems.append(f"Cargo.toml: [workspace.lints.clippy] {lint} must be \"deny\" (tests opt out with #[allow])")
    clippy_toml = next((p for p in (root / "clippy.toml", root / ".clippy.toml") if p.exists()), None)
    if clippy_toml is None:
        problems.append("clippy.toml is missing (disallowed-methods for blocking calls in async code)")
    else:
        conf = tomllib.loads(clippy_toml.read_text(encoding="utf-8"))
        paths = {(m.get("path") if isinstance(m, dict) else m) for m in conf.get("disallowed-methods", [])}
        for m in REQUIRED_DISALLOWED - paths:
            problems.append(f"{clippy_toml.name}: disallowed-methods must include {m}")
    for d in member_dirs(root, ws):
        rel = d.relative_to(root).as_posix()
        man = tomllib.loads((d / "Cargo.toml").read_text(encoding="utf-8"))
        me = short(man.get("package", {}).get("name", ""))
        if me is None:
            continue
        if not man.get("lints", {}).get("workspace"):
            problems.append(f"{rel}/Cargo.toml: add [lints] workspace = true")
        if me not in ALLOWED:
            problems.append(f"{rel}: crate lecter-{me} is not in the architecture table (01-architecture.md); add it there first")
            continue
        for dep, spec in deps_of(man, ws_deps).items():
            other = short(dep)
            if other is None:
                continue
            if other not in ALLOWED[me]:
                problems.append(f"{rel}: lecter-{me} → lecter-{other} is not an allowed dependency (01-architecture.md)")
            elif (me, other) in PROTO_ONLY:
                feats = set(spec.get("features", []))
                if spec.get("default-features", True) or feats != {"proto"}:
                    problems.append(f"{rel}: lecter-{me} may use lecter-{other} only with default-features = false, features = [\"proto\"]")
    return problems, None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Architecture lint")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    root = Path(ap.parse_args(argv).root).resolve()
    problems, note = check(root)
    for p in problems:
        print(p)
    print(f"ARCH OK ({note})" if note else "ARCH OK" if not problems else f"{len(problems)} architecture problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
