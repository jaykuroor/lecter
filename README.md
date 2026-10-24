<div align="center">

# Lecter

**Annotate lecture slides live. Ask about any line. Keep up with the professor.**

A fast, local-first desktop app for students in lectures: the professor's slides become your notes, and AI explanations appear right under the line you're stuck on. Use it with the mouse like Slack or Discord, or entirely with Vim keys.

[![CI](https://github.com/jaykuroor/lecter/actions/workflows/ci.yml/badge.svg)](https://github.com/jaykuroor/lecter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

</div>

> **Status: pre-alpha.** Lecter v0 is under active development and not ready for daily use yet. Follow the milestones below or watch the repository for the first release.

## Why Lecter

Lectures move faster than understanding. You either copy slides and fall behind, or you listen and lose the details. Lecter opens the professor's slides as an editable document, so you only write what's yours:

- **Your understanding**, as notes between the lines.
- **What you don't get**, asked in two keystrokes and answered in place, grounded in your own textbook and past lectures.
- **What you'll check later**, as parked doubts and flags that turn into a revision list.

Everything is a plain Markdown file in a folder you own. Lecter adds no account, no server and no lock-in.

## Features (v0)

- **Slides become text.** PDF, PowerPoint, images and scans are read once into clean Markdown and LaTeX. Charts become figure cards you can ask about. Animation build-steps are merged.
- **Glosses.** AI answers sit under the exact line they explain:

  | Key | Gloss |
  |---|---|
  | `a` | Ask about this line |
  | `s` | Step-by-step derivation, with numeric checks |
  | `K` | Define terms |
  | `x` | Worked example |
  | `D` | Park a doubt, answered in the background |

  You can rate, regenerate and switch between versions of every gloss.
- **Grounded in your course.** Lecter searches your textbooks, syllabus, past papers and earlier lectures before it answers, and uses the provider's own web search when you allow it.
- **Interactive figures.** Plots and explorable diagrams, generated on request or proposed automatically, with an estimate of the time and cost first.
- **Course dashboard.** Lectures, flags, open doubts, a revision list and "ask the whole course", with past-exam questions matched to topics.
- **Keyboard-first, mouse-friendly.** LazyVim-style keys with an always-visible hint bar and on-screen keycaps; everything also works with clicks and menus.
- **Your providers, your keys.** Claude, OpenAI, Gemini, any OpenAI-compatible or local server; subscription sign-in where the provider allows it. Fast models by default, prompt caching throughout.
- **Native look.** Follows your GTK theme on Linux, and the system appearance on macOS and Windows.
- **Private by default.** Untrusted files are parsed in a sandbox. The AI can only add visible, undoable notes. Lecter has no telemetry.

## How it looks on disk

```
WRIT101/
├── slides/                 # the professor's files, never modified
├── sources/                # textbooks, syllabus, past papers
├── lectures/
│   └── 2026-10-23-l07-building-an-argument.md
├── course.md               # revise list, office-hours questions, notes
└── .lecter/                # settings, roles, skills, caches
```

A lecture file is readable anywhere:

```markdown
::: {.slide #s3 n=3 src="A3" title="Claims and evidence"}
## Claims and evidence

[A claim is only as strong as the evidence that supports it.]{#s3b1}

[Counterarguments make an essay more convincing, not less.]{#s3b2 .flag}

::: {.gloss #g-7f3a kind=ask key=a anchor=s3b2 by=ai}
**you asked:** why would admitting the other side help?

It shows the reader you have tested your claim. Answering the strongest objection …
:::

::: {.note #n-91c0 anchor=s3b2}
Try this in the next draft.
:::
:::
```

## Install

Lecter has no release yet. Once there is one, signed builds will be on the [Releases](https://github.com/jaykuroor/lecter/releases) page:

| OS | Package |
|---|---|
| macOS 13+ | `.dmg` (Apple Silicon and Intel) |
| Windows 10/11 | `.exe` installer or `.msi` |
| Linux | AppImage, Flatpak, `.deb`, `.rpm` |

## Build from source

**Requirements:** Rust (stable, via [rustup](https://rustup.rs)), Node.js LTS with pnpm (`corepack enable`), Python 3.10+, and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/jaykuroor/lecter.git
cd lecter
scripts/init.sh      # install dependencies and build
scripts/dev.sh       # run the app with hot reload
scripts/verify.sh    # format, lint, type-check and test
```

## Configuration

Settings live in `~/.config/lecter/` on Linux and macOS, and `%APPDATA%\lecter\` on Windows. Each course can override them in `.lecter/course.jsonc`. You can change everything three ways: in the Settings window (`Ctrl/Cmd-,`), with `:set key=value`, or by editing the JSONC files.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 | Foundations: workspace, UI and app shells, CI, risk spikes | Planned |
| M0.5 | Walking skeleton: open, parse, edit, save, search, one gloss and one figure, on all three OSes | Planned |
| M1 | App shell, settings, courses, keys, hint bar, theming | Planned |
| M2 | Lecture files, slide parsing, editing, flags | Planned |
| M3 | Providers and sign-in, agent harness, glosses, keycaps, web search | Planned |
| M4 | Course retrieval, course card and digest, vision, figure cards | Planned |
| M5 | Interactive figures, dashboard, revise sessions | Planned |
| M6 | Onboarding and tutorial, export, hardening, signed packages | Planned |

Later: live transcript and catch-up, flashcards with spaced repetition, board photos, more slide formats, a command-line tool.

## Contributing

Lecter is built spec-first. The product spec lives in [`docs/spec/`](docs/spec/), the design in [`docs/design/`](docs/design/), and every change must keep [`scripts/verify.sh`](scripts/verify.sh) green. See [`AGENTS.md`](AGENTS.md) for engineering rules and [`docs/TESTING.md`](docs/TESTING.md) for how to add tests. Issues and pull requests are welcome once v0 lands.

## License

[MIT](LICENSE) © 2026 Jay Kuroor
