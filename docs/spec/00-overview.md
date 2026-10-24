# 00 · Overview

Lecter is an open-source (MIT) desktop app for students in a live lecture. They use it to annotate the professor's slides as the lecture happens, record what they understand, what they don't and what they aren't sure about, look things up fast, and stay with the professor. It runs on macOS, Windows and Linux. Users connect their own AI providers. There is no Lecter server in v0.

This folder is the single source of truth for v0. If code and spec disagree, the spec wins. If the spec is wrong or silent, follow `docs/DECISIONS.md`, or ask in `docs/QUESTIONS.md`.

## Principles (in priority order)

1. **Best AI answer for the fewest tokens and the least latency.** Win through context management and prompt engineering, not bigger prompts. Use the providers' own strengths (their web search, their image understanding, prompt caching) and fast models by default.
2. **Minimal compute and memory.** Nothing runs or stays loaded unless it is in use. Idle CPU is about 0%. Battery matters.
3. **Never lose a note.** The user's files are the truth, saved within 250 ms, and crash-safe.
4. **GUI-first, Vim on top.** Everything works with mouse and keyboard like Slack or Discord. LazyVim-style keys make every action faster, and the keys are always visible.
5. **Everything configurable.** Every default (models, search, figures, parsing, keys, theme) can be changed globally, per course, per gloss type and, where it makes sense, per prompt.
6. **Secure by construction.** Untrusted files are parsed in a sandbox. The AI cannot act outside visible, undoable note actions.
7. **Plain files.** Pandoc Markdown that works without Lecter.

## v0 scope

| In v0 | Not in v0 (see `15-later.md`) |
|---|---|
| Course folders: open, trust, tag, dashboard, `course.md` | Live transcript, rewind (`⌫`), catch-up (`c`), live slide (`gl`) |
| Lecture files with one or more slide files | Board photos |
| PDF, PPTX, images and scans through the reading ladder; figure cards; build steps | ODP, Keynote, Google Slides, Beamer source, Marp, Typst, Jupyter |
| Glosses: ask, steps, doubt, define, example, write, tidy, selection-ask, rate, regenerate, variants, detail | Flashcards with spaced repetition, quick checks, try-first |
| Agent harness with course retrieval, web search, figures (Auto/Ask) | Study pack on `:wq`, pre-class prep |
| Providers: API keys, subscription sign-in where allowed, local servers | Lecter-hosted models, cloud sync |
| Settings window, `:set`, JSONC files, GTK theming, onboarding with tutorial course | Plugins, Lua |
| Signed packages for macOS 13+, Windows 10/11, Linux | Tablets |

## Glossary

- **Course**: a folder the user opened and trusted. See `02-course-folder.md`.
- **Lecture**: one Markdown file in `lectures/` with a date and zero or more slide files.
- **Block**: one paragraph, equation, list item, table, code block or figure, with a stable id.
- **Gloss**: an AI answer or user note attached under a block, stored as a Pandoc fenced div.
- **Role** (also "agent"): one AI behaviour bound to a key, such as `ask` (`a`) or `steps` (`s`). Defined by a Markdown file with front matter.
- **Skill**: an instruction file the AI loads only when it decides it needs it.
- **Figure card**: a short text description of a figure, written once and reused as context.
- **Course card**: structured facts from the syllabus (dates, weekly topics, exam scope).
- **Course digest**: a short summary per lecture, kept in every prompt.
- **Reading ladder**: the ordered ways Lecter reads a file, cheapest first.
- **Tier 0/1/2**: the layers of AI context. See `05-retrieval.md`.

## Spec map

| File | Covers |
|---|---|
| `01-architecture.md` | Stack, processes, repository layout, document model |
| `02-course-folder.md` | Course layout, trust, AGENTS.md, roles, skills |
| `03-lecture-files.md` | File format, gloss syntax, naming |
| `04-parsing.md` | Reading ladder, every kind of material, figure cards |
| `05-retrieval.md` | Context tiers, indexing, embeddings |
| `06-ai-harness.md` | Agent loop, roles, tools, permissions, web search, caching |
| `07-providers.md` | Providers, sign-in, models |
| `08-figures.md` | Interactive figures, sandbox, Auto/Ask |
| `09-ui.md` | Layout, Slack/Discord behaviour, hint bar, keycaps, prompt row |
| `10-keymap.md` | Every key and command |
| `11-dashboard.md` | Course dashboard and revise sessions |
| `12-settings-theme-onboarding.md` | Settings, theming, onboarding |
| `13-security.md` | Threat model and mitigations |
| `14-quality.md` | Performance budgets, tests, definition of done |
| `15-later.md` | Deferred features and future business plans (do not build) |
| `16-ci-cd.md` | CI/CD workflows, merging, pushing, versions, changelog |
| `17-robustness.md` | File watcher, external edits, data versioning, file-system edge cases, provider drift |
| `18-contracts.md` | IPC commands and errors, worker protocol, `state.db` schema, journal format |

Visual design: `docs/design/`. How to add tests: `docs/TESTING.md`.
