"""The perf harness behind tests/perf/budgets.sh (14-quality.md#perf-harness, F-025).

It reads tests/perf/budgets.json, runs each measurement script once for all the budgets it
measures, prints one line per budget (`PASS keystroke_p99_ms 5.1 / 8`), writes
tests/perf/report.json and exits 1 on a breach (2 on a usage or budgets-file error).

- A script is called with the ids it should measure and prints one JSON line per id:
  {"id": ..., "value": <number>, "detail": "..."} (or "error": "..." instead of value). Any other
  output is its log, kept in <logs>/<script>.log.
- `--ci` (also when the CI environment variable is set): a `kind: timing` value gets x1.5 and a
  value over that is measured once more; it fails only if both runs are over. Locally timing gates
  at x1 on one run. memory, size, tokens and cpu budgets are exact everywhere.
- `per_os` ({"linux"|"darwin"|"win32": target}) replaces `budget` as the target on that OS; an OS
  it doesn't list prints REPORT (measured, never fails) until its target is set.
- `on_ci: "report"`: with --ci the value prints REPORT and never fails (CI renders in software);
  a `quick` script, if the budget has one, gates in its place (keystroke_p99_ms: the mocked core).
  Without --ci the target is `local` (per OS: the maintainer's machine; an OS it doesn't list
  prints REPORT) when the entry has one, else `per_os` or `budget`.
- `median_of: N`: the script prints {"id", "samples": [N values]} and the median is gated at x1,
  with no CI allowance and no re-measure (cold_open_ms, D-152).
- A budget without a script prints PENDING, and fails once every feature of its `from` milestone
  is done (docs/features.json).
- `--quick` runs each budget's `quick` script and skips the others; `job: nightly` budgets run
  only with `--nightly` or `--only`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CI_ALLOWANCE = 1.5
KINDS = {"timing", "memory", "size", "tokens", "cpu"}
OSES = {"linux", "darwin", "win32"}


class UsageError(Exception):
    """A bad argument or budgets file: exit 2."""


def this_os() -> str:
    return "linux" if sys.platform.startswith("linux") else sys.platform


@dataclass
class Budget:
    id: str
    budget: float
    cmp: str
    unit: str
    kind: str
    milestone: str
    script: str | None
    quick: str | None
    nightly: bool
    per_os: dict[str, float] | None = None
    local: dict[str, float] | None = None
    on_ci: str | None = None
    median_of: int | None = None
    source: str = "script"  # "quick": the quick check that gates for an on_ci budget under --ci
    values: list[float] = field(default_factory=list)
    samples: list[list[float]] = field(default_factory=list)
    details: list[str] = field(default_factory=list)
    status: str = ""
    note: str = ""

    def target(self, ci: bool, os_name: str) -> float | None:
        """The target here, before any CI allowance (None: this OS has none yet, so REPORT)."""
        table = self.local if self.local is not None and not ci and self.source == "script" else self.per_os
        return self.budget if table is None else table.get(os_name)

    def allowance(self, ci: bool) -> bool:
        return ci and self.kind == "timing" and self.median_of is None

    def limit(self, ci: bool, os_name: str) -> float | None:
        t = self.target(ci, os_name)
        return None if t is None else t * CI_ALLOWANCE if self.allowance(ci) else t

    def reports(self, ci: bool, os_name: str) -> bool:
        """Measured but never failing: on_ci budgets under --ci, and an OS with no target."""
        return (ci and self.on_ci == "report" and self.source == "script") or self.target(ci, os_name) is None

    def within(self, value: float, ci: bool, os_name: str) -> bool:
        lim = self.limit(ci, os_name)
        if lim is None:
            return True
        return value < lim if self.cmp == "lt" else value <= lim


def num(x: float) -> str:
    """A value as printed: integers without a point, others with up to two decimals."""
    return str(int(x)) if float(x).is_integer() else f"{x:.2f}".rstrip("0").rstrip(".")


def median(xs: list[float]) -> float:
    s = sorted(xs)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def os_targets(path: Path, bid: str, key: str, table: object) -> dict[str, float] | None:
    if table is None:
        return None
    if not isinstance(table, dict) or not set(table) <= OSES:
        raise UsageError(f"{path}: {bid} {key} must map some of {sorted(OSES)} to targets")
    for v in table.values():
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0:
            raise UsageError(f"{path}: {bid} {key} targets must be positive numbers")
    return {k: float(v) for k, v in table.items()}


def load_budgets(path: Path) -> list[Budget]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise UsageError(f"{path}: {e}") from e
    items = data.get("budgets") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise UsageError(f"{path}: expected {{\"budgets\": [...]}}")
    out: list[Budget] = []
    for e in items:
        bid = e.get("id") if isinstance(e, dict) else None
        if not isinstance(bid, str) or not re.fullmatch(r"[a-z0-9_]+(\.[a-z0-9]+)?", bid):
            raise UsageError(f"{path}: bad id in {e!r}")
        if any(b.id == bid for b in out):
            raise UsageError(f"{path}: {bid} is listed twice")
        value = e.get("budget")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise UsageError(f"{path}: {bid} needs a positive numeric budget")
        if e.get("cmp") not in ("lt", "le"):
            raise UsageError(f"{path}: {bid} cmp must be lt or le")
        if e.get("kind") not in KINDS:
            raise UsageError(f"{path}: {bid} kind must be one of {sorted(KINDS)}")
        if not isinstance(e.get("from"), str) or not re.fullmatch(r"M\d+(\.\d+)?", e["from"]):
            raise UsageError(f"{path}: {bid} from must be a milestone like M0.5")
        for key in ("script", "quick"):
            s = e.get(key)
            if s is not None and not (isinstance(s, str) and (ROOT / s).is_file()):
                raise UsageError(f"{path}: {bid} {key} {s!r} is not a file")
        if e.get("on_ci") not in (None, "report"):
            raise UsageError(f"{path}: {bid} on_ci must be \"report\"")
        n = e.get("median_of")
        if n is not None and (isinstance(n, bool) or not isinstance(n, int) or n < 1):
            raise UsageError(f"{path}: {bid} median_of must be a positive whole number")
        out.append(Budget(bid, float(value), e["cmp"], str(e.get("unit", "")), e["kind"], e["from"],
                          e.get("script"), e.get("quick"), e.get("job") == "nightly",
                          os_targets(path, bid, "per_os", e.get("per_os")), os_targets(path, bid, "local", e.get("local")),
                          e.get("on_ci"), n))
    return out


def done_milestones(path: Path) -> set[str]:
    """Milestones whose every feature is done."""
    try:
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise UsageError(f"{path}: {e}") from e
    by: dict[str, bool] = {}
    for f in features:
        m = f.get("milestone")
        by[m] = by.get(m, True) and f.get("status") == "done"
    return {m for m, ok in by.items() if ok}


def run_script(script: str, ids: list[str], logs: Path) -> tuple[dict[str, dict], str]:
    """Runs `script` for `ids`: the JSON results by id, and a failure note ('' when it exited 0)."""
    path = ROOT / script
    if path.suffix == ".py":
        cmd = [sys.executable, str(path)]
    elif path.suffix == ".sh":
        # Found on PATH: on Windows a bare "bash" would start System32's WSL launcher, not Git Bash.
        cmd = [shutil.which("bash") or "bash", str(path)]
    else:
        cmd = [str(path)]
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / (re.sub(r"[^A-Za-z0-9]+", "-", script).strip("-") + ".log")
    with open(log, "a", encoding="utf-8") as lf:
        lf.write(f"== {script} {' '.join(ids)}\n")
        lf.flush()
        proc = subprocess.run(cmd + ids, cwd=ROOT, stdout=subprocess.PIPE, stderr=lf, text=True)
        lf.write(proc.stdout)
    results: dict[str, dict] = {}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("id") in ids:
            results[r["id"]] = r
    note = "" if proc.returncode == 0 else f"{script} exit {proc.returncode}; log {log}"
    return results, note


def numbers(xs: object) -> list[float] | None:
    ok = isinstance(xs, list) and all(isinstance(x, (int, float)) and not isinstance(x, bool) and x == x for x in xs)
    return [float(x) for x in xs] if ok else None  # type: ignore[union-attr]


def take(b: Budget, r: dict, quick: bool, note: str) -> None:
    """Records one script result for `b`: a value (or the median of its samples) or a failure."""
    v = r.get("value")
    if b.median_of is not None and not quick and b.source == "script":
        samples = numbers(r.get("samples"))
        if samples is None or len(samples) != b.median_of:
            got = "no samples" if samples is None else f"{len(samples)} samples"
            why = r.get("error") or note
            b.status = "fail"
            b.note = f"no measurement: needs the median of {b.median_of}, got {got}" + (f" ({why})" if why else "")
            return
        b.samples.append(samples)
        v = median(samples)
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v:
        b.values.append(float(v))
        details = r.get("details") if isinstance(r.get("details"), list) else [r.get("detail", "")]
        b.details.append(" | ".join(str(d) for d in details))
        if note:  # a script that failed can't vouch for what it printed
            b.status, b.note = "fail", note
    else:
        b.status = "fail"
        b.note = f"no measurement: {r.get('error') or note or 'the script printed no value'}"


def measure(budgets: list[Budget], quick: bool, logs: Path) -> None:
    """One run of each script for the budgets it measures; appends a value or sets a failure."""
    groups: dict[str, list[Budget]] = {}
    for b in budgets:
        script = b.quick if quick or b.source == "quick" else b.script
        groups.setdefault(script or "", []).append(b)
    for script, members in groups.items():
        results, note = run_script(script, sorted({b.id for b in members}), logs)
        for b in members:
            take(b, results.get(b.id, {}), quick, note)


def evaluate(budgets: list[Budget], args: argparse.Namespace, done: set[str], logs: Path) -> list[Budget]:
    """Measures and gates `budgets`. Returns them, each on_ci budget under --ci followed by the
    quick check that gates in its place."""
    ci, here = args.ci, args.os
    to_run: list[Budget] = []
    shown: list[Budget] = []
    for b in budgets:
        shown.append(b)
        if args.only and b.id not in args.only:
            b.status = "unselected"
        elif b.script is None:
            b.status = "pending"
            b.note = f"no measurement yet; gates from {b.milestone}"
            if b.milestone in done:
                b.status, b.note = "fail", f"no measurement yet, and {b.milestone} is done"
        elif b.nightly and not (args.nightly or args.only):
            b.status, b.note = "nightly", "measured in the nightly run"
        elif args.quick and b.quick is None:
            b.status, b.note = "skip", "not in --quick"
        else:
            to_run.append(b)
            if ci and not args.quick and b.on_ci == "report" and b.quick:
                twin = replace(b, source="quick", median_of=None, values=[], samples=[], details=[])
                to_run.append(twin)
                shown.append(twin)
    measure(to_run, args.quick, logs)
    again = [b for b in to_run if not b.status and b.allowance(ci) and not b.reports(ci, here)
             and not b.within(b.values[0], ci, here)]
    if again:
        measure(again, args.quick, logs)
    for b in to_run:
        if b.status:
            continue
        if b.reports(ci, here):
            b.status = "report"
            continue
        counted = b.values[:2] if b.allowance(ci) else b.values[:1]
        b.status = "pass" if any(b.within(v, ci, here) for v in counted) else "fail"
    return shown


def why_report(b: Budget, ci: bool, os_name: str) -> str:
    if ci and b.on_ci == "report":
        return "real app under --ci: reported, never fails; " + (
            "the quick check gates" if b.quick else "it gates locally")
    table = "local" if b.local is not None and not ci else "per_os"
    return f"no {os_name} target in {table} yet"


def line(b: Budget, ci: bool, os_name: str) -> str:
    if b.status in ("pending", "nightly", "skip"):
        return f"{b.status.upper()} {b.id} ({b.note})"
    if b.status == "fail" and not b.values:
        prefix = "PENDING" if b.script is None else "FAIL"
        return f"{prefix} {b.id} ({b.note})"
    values = ", ".join(num(v) for v in b.values)
    if b.samples:
        values += " (median of " + "; ".join(" ".join(num(x) for x in s) for s in b.samples) + ")"
    lim = b.limit(ci, os_name)
    target = "" if lim is None else f" / {num(lim)}"
    if b.status == "report":  # against the plain target: nothing is allowed for, nothing gates
        plain = b.target(ci, os_name)
        return f"REPORT {b.id} {values}{'' if plain is None else f' / {num(plain)}'} ({why_report(b, ci, os_name)})"
    allowance = f" ({num(b.target(ci, os_name) or 0)} x1.5 CI allowance)" if b.allowance(ci) else ""
    text = f"{b.status.upper()} {b.id} {values}{target}{allowance}"
    if b.source == "quick":
        text += f"  [quick check {b.quick}, gating for the real app under --ci]"
    return text + (f"  [{b.note}]" if b.note else "")


def report(shown: list[Budget], args: argparse.Namespace, ok: bool) -> dict:
    mode = "quick" if args.quick else "ci" if args.ci else "local"
    return {
        "mode": mode,
        "os": args.os,
        "ok": ok,
        "budgets": [
            {"id": b.id, "source": b.source, "status": b.status, "values": b.values, "samples": b.samples,
             "details": b.details, "limit": b.limit(args.ci, args.os), "budget": b.budget, "per_os": b.per_os,
             "local": b.local, "cmp": b.cmp, "unit": b.unit, "kind": b.kind, "from": b.milestone, "note": b.note}
            for b in shown
        ],
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="tests/perf/budgets.sh", description=__doc__.split("\n\n")[0])
    p.add_argument("--ci", action="store_true", help="CI rule for timing budgets (also when $CI is set)")
    p.add_argument("--quick", action="store_true", help="only the quick checks (and PENDING gates)")
    p.add_argument("--nightly", action="store_true", help="also the nightly-only budgets")
    p.add_argument("--only", action="append", metavar="ID", help="just this budget (repeatable)")
    p.add_argument("--os", choices=sorted(OSES), default=this_os(), help="whose per-OS targets apply (default: this one)")
    p.add_argument("--budgets", type=Path, default=ROOT / "tests/perf/budgets.json")
    p.add_argument("--features", type=Path, default=ROOT / "docs/features.json")
    p.add_argument("--report", type=Path, default=ROOT / "tests/perf/report.json")
    p.add_argument("--logs", type=Path, default=ROOT / "tests/perf/logs")

    try:
        args = p.parse_args(argv)
    except SystemExit as e:
        raise UsageError("bad arguments") from e
    if os.environ.get("CI", "").lower() not in ("", "0", "false"):
        args.ci = True
    return args


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        budgets = load_budgets(args.budgets)
        unknown = sorted(set(args.only or []) - {b.id for b in budgets})
        if unknown:
            raise UsageError(f"unknown budget id: {', '.join(unknown)}")
        done = done_milestones(args.features)
    except UsageError as e:
        print(f"budgets.sh: {e}", file=sys.stderr)
        return 2
    shown = [b for b in evaluate(budgets, args, done, args.logs) if b.status != "unselected"]
    for b in shown:
        print(line(b, args.ci, args.os))
    ok = not any(b.status == "fail" for b in shown)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report(shown, args, ok), indent=2) + "\n", encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Performance budgets\n\n```\n" + "\n".join(line(b, args.ci, args.os) for b in shown) + "\n```\n\n")
    print("PERF OK" if ok else "PERF FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
