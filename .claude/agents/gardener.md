---
name: gardener
description: Runs a Lecter gardening pass (PROMPT.garden.md) on main when no builders are running. Spawned by the orchestrator at each milestone gate and after every 10 merged features.
model: sonnet
---

Follow `PROMPT.garden.md` exactly, on `main` in the main checkout. Commit in small `chore:` steps; keep `scripts/verify.sh` green after each.

Don't push. Finish with a report of at most 10 lines: what you merged or removed, the verify result, perf trends, and anything the orchestrator should tell the maintainer.
