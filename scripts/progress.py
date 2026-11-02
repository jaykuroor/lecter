#!/usr/bin/env python3
"""Small, safe edits to docs/PROGRESS.md for the orchestrator.

  scripts/progress.py resume "<one line>"   set the 'Resume point' line in Current state
The resume point is what a fresh orchestrator (for example after a usage limit) reads first.
Write it before every dispatch and merge: what is running, what was about to happen next.
"""
import datetime, re, sys
from lib_features import DOCS

P = DOCS / "PROGRESS.md"


def main(argv):
    if len(argv) != 2 or argv[0] != "resume":
        print(__doc__.strip())
        return 2
    text = argv[1].strip().replace("\n", " ")
    if len(text) > 300:
        print("keep the resume point under 300 characters")
        return 1
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    line = f"- Resume point ({stamp}): {text}"
    body = P.read_text(encoding="utf-8")
    head, sep, tail = body.partition("<!-- LOG -->")
    if re.search(r"^- Resume point.*$", head, re.M):
        head = re.sub(r"^- Resume point.*$", line, head, count=1, flags=re.M)
    else:
        head = re.sub(r"(## Current state\n)", r"\1" + line.replace("\\", "\\\\") + "\n", head, count=1)
    P.write_text(head + sep + tail, encoding="utf-8")
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
