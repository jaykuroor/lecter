#!/usr/bin/env python3
"""Tallies the IME flow's check lines (tests/e2e/flows/ime.ts) per webview.

    python3 spikes/ime/summary.py <log>...      # e2e-app.log files or a CI run's log

Each check line reads `IME <webview> <case> <check>: ok|FAIL|observed (<detail>)`; anything
before `IME` (CI job and step names, timestamps, wdio's `[0-0]`) is ignored. Prints, per webview,
the checks passed out of all, every failure, and the observations. Exit 1 if any check failed or
no check line was found.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict

WEBVIEWS = ("WebKitGTK", "WKWebView", "WebView2")
LINE = re.compile(r"\bIME (\S+) (insert|normal) (.+?): (ok|FAIL|observed) \((.*)\)\s*$")


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__)
        return 2
    seen: dict[str, dict[tuple[str, str], tuple[str, str]]] = defaultdict(dict)
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as f:
            for raw in f:
                m = LINE.search(raw)
                if m:
                    webview, case, check, result, detail = m.groups()
                    # The last run of a check wins (a log can hold a retried flow).
                    seen[webview][(case, check)] = (result, detail)
    if not seen:
        print("no IME check lines found")
        return 1
    failed = False
    for webview in WEBVIEWS:
        if webview not in seen:
            print(f"{webview}: no check lines (job passed without an artifact? pass its job summary)")
    for webview in sorted(seen):
        checks = seen[webview]
        graded = {k: v for k, v in checks.items() if v[0] != "observed"}
        ok = sum(1 for r, _ in graded.values() if r == "ok")
        print(f"{webview}: {ok}/{len(graded)} checks ok")
        for (case, check), (result, detail) in sorted(checks.items()):
            if result == "FAIL":
                failed = True
                print(f"  FAIL {case} / {check}: {detail}")
            elif result == "observed":
                print(f"  observed {case} / {check}: {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
