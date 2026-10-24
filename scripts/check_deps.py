#!/usr/bin/env python3
"""Dependency lint: enforces docs/spec/01-architecture.md#dependency-policy against the change's base.

  python3 scripts/check_deps.py [--base REF] [--root DIR]

Fails when the change, without the trailer it needs:
  - adds a direct dependency (any Cargo.toml table, ui/package.json)    needs  Dep-Added: <name> - <licence>, <why>
  - adds a native package to Cargo.lock (it builds C/C++ via cc, cmake, bindgen, pkg-config or vcpkg,
    or is a known native runtime) not covered by scripts/deps_preapproved.txt
  - adds more than 30 packages to Cargo.lock
  - adds a UI package whose Dep-Added trailer reports gz=<n>KB above 100
The last three need  Deps-Approved: D-0NN  where D-0NN is a decision by Jay (the builder reports NEEDS_JAY).
`scripts/add_dep.py` adds packages and prints the trailer to use.
"""
import argparse, fnmatch, json, re, sys, tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_git import find_base, git, jay_decision, old_text, trailers  # noqa: E402

NATIVE_BUILD = {"cc", "cmake", "bindgen", "pkg-config", "vcpkg", "system-deps", "autotools"}
NATIVE_NAMES = {"ort", "ort-sys", "onnxruntime", "pdfium-render", "llama-cpp-2", "llama-cpp-sys-2", "tch", "openssl"}
MAX_NEW_CRATES = 30
MAX_UI_KB_GZ = 100


def lock_packages(text):
    if not text:
        return {}
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return {}
    out = {}
    for p in data.get("package", []):
        deps = {d.split()[0] for d in p.get("dependencies", [])}
        out[p["name"]] = deps | out.get(p["name"], set())
    return out


def manifest_deps(text, is_package_json):
    if not text:
        return set()
    try:
        if is_package_json:
            d = json.loads(text)
            return set(d.get("dependencies", {})) | set(d.get("devDependencies", {})) | set(d.get("optionalDependencies", {}))
        d = tomllib.loads(text)
    except (ValueError, tomllib.TOMLDecodeError):
        return set()
    names = set()
    tables = [d, d.get("workspace", {})] + list(d.get("target", {}).values())
    for t in tables:
        for key in ("dependencies", "dev-dependencies", "build-dependencies"):
            for name, spec in t.get(key, {}).items():
                names.add(spec.get("package", name) if isinstance(spec, dict) else name)
    return {n for n in names if not n.startswith("lecter-")}


def manifests(root, base):
    files = set(git(root, "ls-files", "Cargo.toml", "*/Cargo.toml", "ui/package.json").stdout.split())
    files |= set(git(root, "ls-files", "--others", "--exclude-standard", "Cargo.toml", "*/Cargo.toml", "ui/package.json").stdout.split())
    if base:
        files |= set(git(root, "diff", "--name-only", base, "--", "Cargo.toml", "*/Cargo.toml", "ui/package.json").stdout.split())
    return sorted(files)


def preapproved(root):
    p = Path(root) / "scripts" / "deps_preapproved.txt"
    if not p.exists():
        return []
    return [l.split("#")[0].strip() for l in p.read_text().splitlines() if l.split("#")[0].strip()]


def check(root, base):
    if base is None:
        return []
    tr = trailers(root, base, ("Dep-Added", "Deps-Approved"))
    added_ok = {v.rstrip(":") : rest for v, rest in tr["Dep-Added"]}
    approved = any(jay_decision(root, v) for v, _ in tr["Deps-Approved"])
    problems = []
    new_direct = set()
    for path in manifests(root, base):
        fp = Path(root) / path
        new = manifest_deps(fp.read_text(encoding="utf-8") if fp.exists() else "", path.endswith(".json"))
        old = manifest_deps(old_text(root, base, path), path.endswith(".json"))
        for name in sorted(new - old):
            new_direct.add(name)
            if name not in added_ok and not approved:
                problems.append(f"{path}: new dependency {name} has no 'Dep-Added: {name} - <licence>, <why>' trailer "
                                "(use scripts/add_dep.py)")
            m = re.search(r"gz=(\d+(?:\.\d+)?)\s*KB", added_ok.get(name, ""), re.I)
            if path.endswith(".json") and m and float(m.group(1)) > MAX_UI_KB_GZ and not approved:
                problems.append(f"{name}: adds {m.group(1)} KB gz to the UI (limit {MAX_UI_KB_GZ}); NEEDS_JAY")
    lock = Path(root) / "Cargo.lock"
    new_pkgs = lock_packages(lock.read_text(encoding="utf-8") if lock.exists() else "")
    old_pkgs = lock_packages(old_text(root, base, "Cargo.lock"))
    added = {n: d for n, d in new_pkgs.items() if n not in old_pkgs and not n.startswith("lecter-")}
    if len(added) > MAX_NEW_CRATES and not approved:
        problems.append(f"Cargo.lock: {len(added)} new crates (limit {MAX_NEW_CRATES}); NEEDS_JAY, then Deps-Approved: D-0NN")
    allow = preapproved(root)
    for name, deps in sorted(added.items()):
        native = name in NATIVE_NAMES or bool(deps & NATIVE_BUILD)
        if native and not approved and not any(fnmatch.fnmatchcase(name, g) for g in allow):
            problems.append(f"Cargo.lock: {name} is native (builds or loads C/C++); NEEDS_JAY, then Deps-Approved: D-0NN")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description="Dependency policy lint")
    ap.add_argument("--base")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()
    if git(root, "rev-parse", "--git-dir").returncode != 0:
        print("DEPS SKIP (not a git repository)")
        return 0
    base = find_base(root, a.base)
    problems = check(root, base)
    for p in problems:
        print(p)
    print(f"DEPS OK (base {base or 'none'})" if not problems else f"{len(problems)} dependency problem(s); policy: docs/spec/01-architecture.md#dependency-policy")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
