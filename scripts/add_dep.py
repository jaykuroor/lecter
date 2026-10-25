#!/usr/bin/env python3
"""Add a dependency the way docs/spec/01-architecture.md#dependency-policy allows. Agents use this,
never `cargo add` or `pnpm add` directly (the guard blocks those).

  python3 scripts/add_dep.py rust <crate>[@<ver>] -p lecter-<crate> [--features a,b] [--dev] [--approved D-0NN]
  python3 scripts/add_dep.py ui <package>[@<ver>] [--dev] [--approved D-0NN]

Adds it, then measures: new crates in Cargo.lock, native ones, licences (Rust); licence and gzipped
bundle growth (UI). Within policy: keeps it and prints the commit trailer to use. Outside policy (native,
> 30 crates, > 100 KB gz, or a licence not on the list): undoes the change and prints NEEDS_MAINTAINER with the
numbers for the builder's report. --approved D-0NN (the maintainer's decision) keeps it anyway.
"""
import argparse, gzip, json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_deps import MAX_NEW_CRATES, MAX_UI_KB_GZ, NATIVE_BUILD, NATIVE_NAMES, lock_packages, preapproved  # noqa: E402
from lib_git import maintainer_decision  # noqa: E402
import fnmatch  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LICENCES = re.compile(r"^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|Zlib|MPL-2\.0|Unicode-3\.0|Unicode-DFS-2016|CC0-1\.0|0BSD|BSL-1\.0)$")


def run(*cmd, cwd=ROOT):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{' '.join(cmd)} failed:\n{r.stderr[-2000:]}")
    return r.stdout


def licence_ok(expr):
    if not expr:
        return False
    alts = [a.strip(" ()") for a in re.split(r"\s+OR\s+|/", expr)]
    return any(all(LICENCES.match(p.strip(" ()")) for p in re.split(r"\s+AND\s+", a)) for a in alts)


def snapshot(paths):
    return {p: (ROOT / p).read_bytes() if (ROOT / p).exists() else None for p in paths}


def restore(snap):
    for p, b in snap.items():
        if b is None:
            (ROOT / p).unlink(missing_ok=True)
        else:
            (ROOT / p).write_bytes(b)


def ui_gz_kb():
    dist = ROOT / "ui" / "dist" / "assets"
    run("pnpm", "-C", "ui", "run", "build")
    return sum(len(gzip.compress(p.read_bytes())) for p in dist.glob("*.js")) / 1024


def rust(a):
    manifests = [str(p.relative_to(ROOT)) for p in ROOT.glob("**/Cargo.toml") if "target" not in p.parts]
    snap = snapshot(manifests + ["Cargo.lock"])
    before = lock_packages((ROOT / "Cargo.lock").read_text() if (ROOT / "Cargo.lock").exists() else "")
    cmd = ["cargo", "add", a.name, "-p", a.package] + (["--dev"] if a.dev else []) + (["--no-default-features", "--features", a.features] if a.features else [])
    run(*cmd)
    after = lock_packages((ROOT / "Cargo.lock").read_text())
    new = {n: d for n, d in after.items() if n not in before and not n.startswith("lecter-")}
    meta = json.loads(run("cargo", "metadata", "--format-version", "1"))
    lic = {p["name"]: p.get("license") for p in meta["packages"]}
    allow = preapproved(ROOT)
    native = [n for n, d in new.items() if (n in NATIVE_NAMES or d & NATIVE_BUILD) and not any(fnmatch.fnmatchcase(n, g) for g in allow)]
    bad_lic = [f"{n} ({lic.get(n)})" for n in new if not licence_ok(lic.get(n))]
    name = a.name.split("@")[0]
    print(f"{name}: {len(new)} new crates; licence {lic.get(name)}; native: {', '.join(native) or 'none'}")
    reasons = ([f"{len(new)} new crates (limit {MAX_NEW_CRATES})"] if len(new) > MAX_NEW_CRATES else []) + \
              ([f"native: {', '.join(native)}"] if native else []) + ([f"licence: {', '.join(bad_lic)}"] if bad_lic else [])
    return finish(a, snap, name, reasons, f"{lic.get(name)}, {len(new)} crates")


def ui(a):
    snap = snapshot(["ui/package.json", "ui/pnpm-lock.yaml"])
    has_build = (ROOT / "ui" / "package.json").exists() and '"build"' in (ROOT / "ui" / "package.json").read_text()
    before = ui_gz_kb() if has_build and not a.dev else 0.0
    run("pnpm", "-C", "ui", "add", *(["-D"] if a.dev else []), a.name)
    name = re.sub(r"(?<!^)@[^/]*$", "", a.name)
    pj = json.loads((ROOT / "ui" / "node_modules" / name / "package.json").read_text())
    licence = pj.get("license") if isinstance(pj.get("license"), str) else None
    growth = (ui_gz_kb() - before) if has_build and not a.dev else 0.0
    print(f"{name}: licence {licence}; UI bundle +{growth:.1f} KB gz" + (" (dev only)" if a.dev else ""))
    reasons = ([f"+{growth:.1f} KB gz (limit {MAX_UI_KB_GZ})"] if growth > MAX_UI_KB_GZ else []) + \
              ([f"licence {licence}"] if not licence_ok(licence) else [])
    return finish(a, snap, name, reasons, f"{licence}, gz={growth:.0f}KB")


def finish(a, snap, name, reasons, summary):
    if reasons and not (a.approved and maintainer_decision(ROOT, a.approved)):
        restore(snap)
        print(f"NEEDS_MAINTAINER: {name} is outside the dependency policy ({'; '.join(reasons)}). Change undone.")
        print("Report it with these numbers; once the maintainer's D-entry exists, re-run with --approved D-0NN.")
        return 4
    print("Add to your commit message:")
    print(f"  Dep-Added: {name} - {summary}, <why, alternative rejected>")
    if reasons:
        print(f"  Deps-Approved: {a.approved}")
    print("and list it under DECISIONS in your report.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["rust", "ui"])
    ap.add_argument("name")
    ap.add_argument("-p", "--package", help="lecter-<crate> (rust)")
    ap.add_argument("--features")
    ap.add_argument("--dev", action="store_true")
    ap.add_argument("--approved", help="D-0NN: the maintainer's approval for an out-of-policy dependency")
    a = ap.parse_args(argv)
    if a.kind == "rust" and not a.package:
        ap.error("rust needs -p lecter-<crate>")
    return rust(a) if a.kind == "rust" else ui(a)


if __name__ == "__main__":
    sys.exit(main())
