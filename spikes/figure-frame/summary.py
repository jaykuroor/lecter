#!/usr/bin/env python3
"""Tallies the figure-frame checks (tests/e2e/flows/figure-frame.ts, measure.mjs) per webview.

    python3 spikes/figure-frame/summary.py <log>...      # e2e-app.log files or a CI run's log

Each line reads `FRAME <webview> <scope> <area> <check>: ok|FAIL|observed (<detail>)`; anything
before `FRAME` (CI job and step names, timestamps, wdio's `[0-0]`) is ignored. Prints, per webview,
the checks passed out of all, every failure, the watchdog numbers and the observations. Exit 1 if
a check failed or no line was found.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict

WEBVIEWS = ("WebKitGTK", "WKWebView", "WebView2")
LINE = re.compile(r"\bFRAME (\S+) (\S+) (\S+) (.+?): (ok|FAIL|observed) \((.*)\)\s*$")


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__)
        return 2
    seen: dict[str, dict[tuple[str, str, str], tuple[str, str]]] = defaultdict(dict)
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as f:
            for raw in f:
                m = LINE.search(raw)
                if m:
                    webview, scope, area, check, result, detail = m.groups()
                    # The last run of a check wins (a log can hold a retried flow).
                    seen[webview][(scope, area, check)] = (result, detail)
    if not seen:
        print("no FRAME lines found")
        return 1
    failed = False
    for webview in WEBVIEWS:
        if webview not in seen:
            print(f"{webview}: no lines (job passed without an artifact? pass its job summary)")
    for webview in sorted(seen):
        checks = seen[webview]
        graded = {k: v for k, v in checks.items() if v[0] != "observed"}
        ok = sum(1 for r, _ in graded.values() if r == "ok")
        print(f"{webview}: {ok}/{len(graded)} checks ok")
        for (scope, area, check), (result, detail) in sorted(checks.items()):
            if result == "FAIL":
                failed = True
                print(f"  FAIL {scope} / {area} / {check}: {detail}")
            elif area == "watchdog":
                print(f"  {result} {scope} / watchdog / {check}: {detail}")
            elif result == "observed" and area in ("ipc", "load"):
                print(f"  observed {scope} / {area} / {check}: {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
