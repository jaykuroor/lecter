# 02 · Course folder

A course is a folder. The user opens it (`:open`, the `+` on the course rail, or drag and drop), trusts it once, and it appears on the course rail like a Discord server.

```
STAT311/
├── AGENTS.md              # course instructions for the AI (optional)
├── course.md              # course-wide items: Revise, Office hours, Later, Notes
├── slides/                # professor's files, never modified by Lecter
├── sources/               # textbooks, papers, syllabus, past exams
│   └── past-papers/       # optional; files here are treated as past papers
├── lectures/
│   ├── 2026-09-02-l01-introduction.md
│   └── assets/            # figure sources and their static renders
├── .lecterignore          # optional, gitignore syntax: hidden from the AI
└── .lecter/
    ├── course.jsonc       # course details + settings overrides
    ├── agents/            # role overrides for this course (*.md)
    ├── skills/            # <name>/SKILL.md
    ├── state.db           # parse metadata, ratings, figure proposals, jobs
    ├── journal/           # crash-safety journals
    └── cache/             # index, renders, embeddings; safe to delete; git-ignored
```

Subfolder names are defaults. `course.jsonc` can point `slides`, `sources`, `lectures` and `pastPapers` elsewhere inside the course.

## Trust

- The first open of a folder shows a trust screen: counts of what is inside (for example "3 textbooks, 12 slide decks, 6 lectures"), what the AI may read (everything not in `.lecterignore`), which provider will receive excerpts, and whether web search is on.
- **Trust**: full features. **Open read-only**: notes and slides only; no AI, no figures with scripts, no indexing.
- Trust is stored per absolute path and device in the global config (`trusted.jsonc`). Moving the folder asks again.
- The trust screen also lists the course's own `AGENTS.md`, role files, skills and settings overrides. When any of them changes, trust is asked again. A course can't loosen global settings (`13-security.md` SEC-25), and the core enforces read-only (SEC-27).
- Files outside the course folder are never read by the AI.

## Course details (`course.jsonc`)

```jsonc
{
  "name": "Probability and Statistics",
  "code": "STAT 311",
  "term": "Fall 2026",
  "professor": "Dr. Rivera",
  "icon": "S",            // or a path to an image inside .lecter/
  "color": "#3584e4",
  "folders": { "slides": "slides", "sources": "sources", "lectures": "lectures", "pastPapers": "sources/past-papers" },
  "settings": { }          // any global setting, overridden for this course
}
```

After trusting, a short form fills these. If a syllabus is found in `sources/`, Lecter offers to extract the **course card** (dates, weekly topics, exam scope) with one model call. The user confirms it. It is stored in `.lecter/state.db` and shown on the dashboard.

## AGENTS.md, roles and skills

These use formats other tools already understand.

- **`AGENTS.md`** (course root, optional): plain instructions included in every prompt, for example "The professor writes E[X] for expectation. Exams are proof-heavy." A global `AGENTS.md` in the config folder applies to all courses; both are included, course last.
- **Roles** (`.lecter/agents/<role>.md`): one file per AI behaviour. Built-in defaults ship inside the app; a global file in `~/.config/lecter/agents/` overrides the default, and a course file overrides both. Format:

```markdown
---
role: steps
key: s
model: default-strong      # a model id, or default-fast / default-strong
tools: [search_course, read, toc, compute, figure, note_actions]
web_search: inherit        # on | off | inherit
max_steps: 4
max_output_tokens: 1200
retrieval: { tier1_top_k: 5, book_section: true }
---
Expand the selected derivation into numbered steps. Give the reason for each step...
```

- **Skills** (`.lecter/skills/<name>/SKILL.md`, Agent Skills format): front matter `name` and `description`, then the body. Only names and descriptions go in the prompt; the body is loaded by the `load_skill` tool. Global skills live in `~/.config/lecter/skills/`.

## `course.md`

Course-wide items that belong to no single lecture. Human-editable Markdown with fixed headings:

```markdown
# STAT 311

## Revise
- [ ] Odd functions on symmetric intervals {#r-12 from=l07}

## Office hours
- [ ] Why is r a consistent estimator? {#o-3 from=l07/g-7f3a}

## Later
- [ ] Study Theorem 4.7 {#later-5 due=2026-11-12}

## Notes
Free text and saved answers from "Ask the course".
```

Lecter reads and writes these lists by id. Manual edits are respected and picked up by a file watcher.
