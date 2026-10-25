#!/usr/bin/env python3
"""Mutation testing on the lines a change touched (docs/spec/14-quality.md#mutation-testing).

  python3 scripts/mutants.py [--base REF] [--minutes N]     changed lines only (verify default set)
  python3 scripts/mutants.py --full [--minutes N]           whole tree, reports the score, never fails (nightly)

A mutation tool changes the code on purpose (flips `>` to `>=`, returns a default, drops a call) and reruns the
tests. A mutant that survives is a line no test really checks. Rust: cargo-mutants on the diff against the base
(`lib_git.find_base`). UI: Stryker (Vitest runner) on the changed line ranges of ui/src files. Total time is capped
(default 10 minutes, LECTER_MUTANTS_MINUTES); what the cap cuts off is listed, and the nightly full run covers it.

Every surviving mutant on changed lines fails the check unless a commit in the range carries
  Mutant-Equivalent: <file> - <mutation as printed> - <why no test can tell it from the original>
and the reviewer accepts the reason. Logs and tool output: .verify/mutants/.
"""
import argparse, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_git import find_base, git, trailers  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".verify" / "mutants"
UI_SRC = re.compile(r"^ui/src/.*\.(ts|tsx)$")
UI_TEST = re.compile(r"\.(test|spec)\.(ts|tsx)$|/__tests__/|/e2e/")
SURVIVED_UI = ("Survived", "NoCoverage")

def run_capped(cmd, seconds, cwd, env=None):
    """Run cmd in its own process group; kill the group at the deadline. Returns (returncode | None, output)."""
    log = open(OUT / (Path(cmd[0]).name + ".log"), "a")
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        return p.wait(timeout=max(seconds, 1))
    except subprocess.TimeoutExpired:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(p.pid, sig)
            except ProcessLookupError:
                break
            try:
                p.wait(timeout=10)
                break
            except subprocess.TimeoutExpired:
                continue
        return None
    finally:
        log.close()


def changed_ranges(diff_text):
    """{path: [(start, end)]} of added/changed lines in the new file, from `git diff -U0`."""
    out, cur = {}, None
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            cur = line[6:] if line.startswith("+++ b/") else None
        elif line.startswith("@@") and cur:
            m = re.search(r"\+(\d+)(?:,(\d+))?", line)
            start, count = int(m.group(1)), int(m.group(2) or 1)
            if count:
                out.setdefault(cur, []).append((start, start + count - 1))
    return out


def equivalents(root, base):
    """[(file, rest)] from Mutant-Equivalent trailers in base..HEAD."""
    if base is None:
        return []
    return trailers(root, base, ("Mutant-Equivalent",))["Mutant-Equivalent"]


def excused(path, mutation, eq):
    norm = lambda s: re.sub(r"\s+", " ", s).strip()
    return any(f == path and norm(mutation) in norm(rest) for f, rest in eq)


def rust_survivors(base, seconds, full):
    """(survivors [(path, line, mutation)], total, tested). Skips when there is nothing to mutate."""
    if not (ROOT / "Cargo.toml").exists() or not shutil.which("cargo-mutants"):
        return [], 0, 0
    args = ["cargo", "mutants", "--no-shuffle", "--test-workspace", "false", "--gitignore", "true"]
    if not full:
        diff = git(ROOT, "diff", base, "--", "*.rs").stdout
        if not diff.strip():
            return [], 0, 0
        (OUT / "rust.diff").write_text(diff)
        args += ["--in-diff", str(OUT / "rust.diff")]
    listed = subprocess.run(args + ["--list"], cwd=ROOT, capture_output=True, text=True)
    total = len([l for l in listed.stdout.splitlines() if l.strip()])
    if total == 0:
        return [], 0, 0
    # Copies skip git-ignored files (target/, .verify/, the private corpus); one shared target dir keeps
    # dependency builds warm between runs. Scratch copies go under .verify/ too: the sandbox can write there.
    tmp = ROOT / ".verify" / "mutants-tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    env = dict(os.environ, CARGO_TARGET_DIR=str(ROOT / ".verify" / "mutants-target"), TMPDIR=str(tmp))
    # The verify test stage already proved the unmutated tree passes, so the baseline run is skipped.
    run_capped(args + ["--baseline", "skip", "--timeout", "120", "--output", str(OUT)], seconds, ROOT, env)
    res = OUT / "mutants.out"
    read = lambda n: [l for l in (res / n).read_text().splitlines() if l.strip()] if (res / n).exists() else []
    tested = sum(len(read(n)) for n in ("caught.txt", "missed.txt", "timeout.txt"))  # unviable: did not build
    total -= len(read("unviable.txt"))
    surv = []
    for l in read("missed.txt"):
        m = re.match(r"^(.+?):(\d+):\d+: (.+)$", l)
        if m:
            surv.append((m.group(1), int(m.group(2)), m.group(3)))
    return surv, total, tested


def ui_survivors(base, seconds, full):
    if not (ROOT / "ui" / "node_modules" / "@stryker-mutator" / "core").exists():
        return [], 0, 0
    if full:
        targets = ["src/**/*.ts", "src/**/*.tsx", "!src/**/*.test.ts", "!src/**/*.test.tsx"]
    else:
        ranges = changed_ranges(git(ROOT, "diff", "-U0", base, "--", "ui/src").stdout)
        targets = [f"{p[3:]}:{a}-{b}" for p, rs in sorted(ranges.items()) if UI_SRC.match(p) and not UI_TEST.search(p)
                   for a, b in rs]
        if not targets:
            return [], 0, 0
    report = ROOT / "ui" / "reports" / "mutation" / "mutation.json"
    report.unlink(missing_ok=True)
    # Stryker also loads ui/stryker.config.json. Its `tsconfigFile` names a file that doesn't exist: Stryker's tsconfig
    # rewrite needs TypeScript's JS API, which TypeScript 7 no longer ships, and the CLI can't set that option.
    cmd = ["pnpm", "-C", "ui", "exec", "stryker", "run", "--testRunner", "vitest", "--plugins", "@stryker-mutator/vitest-runner", "--reporters", "json",
           "--incremental", "--incrementalFile", "reports/stryker-incremental.json", "--mutate", ",".join(targets)]
    run_capped(cmd, seconds, ROOT)  # pnpm + Stryker: plugins must be named explicitly
    if not report.exists():
        return [], -1, 0
    data = json.loads(report.read_text())
    surv, total = [], 0
    for path, f in data.get("files", {}).items():
        rel = path if path.startswith("ui/") else "ui/" + re.sub(r"^.*?\bsrc/", "src/", path)
        for m in f.get("mutants", []):
            total += 1
            if m.get("status") in SURVIVED_UI:
                desc = f"{m.get('mutatorName')} -> {m.get('replacement', '')}".strip()
                surv.append((rel, m["location"]["start"]["line"], desc))
    return surv, total, total


def main(argv=None):
    ap = argparse.ArgumentParser(description="Mutation testing on changed lines")
    ap.add_argument("--base")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--minutes", type=float, default=float(os.environ.get("LECTER_MUTANTS_MINUTES", "10")))
    a = ap.parse_args(argv)
    if git(ROOT, "rev-parse", "--git-dir").returncode != 0:
        print("MUTANTS SKIP (not a git repository)")
        return 0
    if not a.full and git(ROOT, "rev-parse", "-q", "--verify", "MERGE_HEAD").returncode == 0:
        print("MUTANTS SKIP (merge in progress: the builder's run on the branch covered these lines)")
        return 0
    base = None if a.full else find_base(ROOT, a.base)
    if not a.full and base is None:
        print("MUTANTS SKIP (no base to compare with)")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    budget, t0 = a.minutes * 60, time.monotonic()
    rs, rtotal, rtested = rust_survivors(base, budget * (0.7 if not a.full else 0.6), a.full)
    us, utotal, utested = ui_survivors(base, budget - (time.monotonic() - t0), a.full)
    eq = equivalents(ROOT, base)
    open_, excused_n = [], 0
    for path, line, mut in rs + us:
        if excused(path, mut, eq):
            excused_n += 1
        else:
            open_.append((path, line, mut))
    total, tested = rtotal + max(utotal, 0), rtested + utested
    killed = tested - len(rs) - len(us)
    lines = [f"{p}:{l}: {m}" for p, l, m in open_]
    (OUT / "survivors.txt").write_text("\n".join(lines) + ("\n" if lines else ""))
    if a.full:
        score = 100.0 * killed / tested if tested else 100.0
        (OUT / "score.json").write_text(json.dumps({"tested": tested, "killed": killed, "score": round(score, 1)}))
        print(f"MUTANTS full tree: {killed}/{tested} killed ({score:.1f}%); survivors in .verify/mutants/survivors.txt")
        return 0
    if utotal == -1:
        print("MUTANTS FAIL: Stryker produced no report (see .verify/mutants/pnpm.log)")
        return 1
    if total == 0:
        print("MUTANTS OK (no mutable code changed)")
        return 0
    capped = f"; CAPPED at {a.minutes:g} min: {total - tested} mutant(s) not run, the nightly full run covers them" if tested < total else ""
    for l in lines:
        print(f"SURVIVED {l}")
    if open_:
        print(f"{len(open_)} surviving mutant(s) on changed lines. For each: add a test that fails on it, or, only if no test "
              "can tell it from the original, add a commit trailer\n  Mutant-Equivalent: <file> - <mutation as printed> - <why>")
        print(f"MUTANTS FAIL ({tested}/{total} tested, {excused_n} marked equivalent{capped})")
        return 1
    print(f"MUTANTS OK ({tested}/{total} tested, {excused_n} marked equivalent{capped})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
