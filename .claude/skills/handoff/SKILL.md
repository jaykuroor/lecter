---
name: handoff
description: Exact formats for docs/PROGRESS.md, docs/DECISIONS.md, docs/QUESTIONS.md and folder CLAUDE.md Learned notes. Use at the end of every session, before the final commit.
---

# Handoff

The next session has none of your memory. Write for a capable stranger who has three minutes. Be specific (paths, ids, numbers); skip narrative.

## docs/PROGRESS.md

The top block (above `<!-- LOG -->`) is printed into every session, so it must be true and **≤ 40 lines**. Rewrite it; don't append to it.

```
## Current state
- Runs: <what a user can do right now in the app, one line>
- Milestone: <M#> · last done: <F-0NN title> · gate: <open M# | none>
- Resume point (<UTC time>): <orchestrator only: what was dispatched or being merged>
- In progress: <F-0NN — exact stopping point> | none
- Watch out: <known breakage, flaky test, perf regression, with path> (max 5)
- Next up: <what next.py will pick, if you know a trap in it>
```

Below `<!-- LOG -->`, add one entry at the top (newest first):

```
### 2026-MM-DD · F-0NN · done|wip|blocked
- Built: <1–2 lines, user-visible terms>
- Code: <main paths touched>
- Tests: <new test files/names>
- Decisions: D-0NN, D-0NN | none
- Follow-ups: <one line> | none
```

## docs/DECISIONS.md

Add one entry at the end, with the next free number:

```
## D-0NN · <decision in ≤ 8 words>
2026-MM-DD · <session F-0NN | maintainer> · active
- Decision: <what, concretely>
- Why: <the reason, with numbers if measured>
- Instead of: <rejected options, one line>
- Revisit if: <trigger> (optional)
```

To reverse a decision, add a new entry and change the old one's status to `superseded by D-0NN`. Never delete entries.

## docs/QUESTIONS.md

Only for questions that can't be answered now: headless runs, or things the maintainer will decide later. In an interactive session, ask the maintainer instead and record a D-entry. Add one entry at the end:

```
## Q-0NN · open|later · blocks: F-0NN | nothing
<the question, answerable in one line>
- Context: <why it matters, 1–2 lines>
- Recommended: <your answer> (applied as default: yes|no)
- Answer:
```

Leave `Answer:` blank; the maintainer fills it in. Planning sessions mark it `answered`.

## Folder CLAUDE.md → `## Learned`

Write one line per lesson in this form: `- <situation> → <what to do> (F-0NN)`. Add a lesson only if it would have saved you ≥ 5 minutes. Put it in the most specific folder it applies to; project-wide lessons go in `AGENTS.md`.

## CHANGELOG.md

Add one line under `## [Unreleased]`, in user-facing words, in the right group (`### Added`, `### Changed`, `### Fixed`). Example: `- Ask about any slide line with \`a\`; answers stream in place (F-060)`.

Then commit everything: `git add -A && git commit -m "F-0NN: …"`.
