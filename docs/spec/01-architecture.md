# 01 · Architecture

## Stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Shell | Tauri 2 (system webview) | Decided by the maintainer. Keep the core UI-agnostic |
| Core | Rust (stable), tokio | All heavy work, all I/O, all network |
| Frontend | TypeScript + SolidJS + Vite | Small and fine-grained (D-005). No other UI framework |
| Document surface | CodeMirror 6 + `@replit/codemirror-vim` | Slides and glosses are widgets and decorations over one text buffer |
| Math | KaTeX, MathML output | `trust: false` |
| PDF | PDFium via `pdfium-render` | Ship the PDFium binary per OS |
| PPTX / XML | `zip` + `quick-xml` | External entities never resolved |
| Search | Tantivy (BM25) + flat int8 vector scan | No vector database |
| Storage | Files (truth) + SQLite via `rusqlite` (caches, jobs, state) | |
| Secrets | `keyring` crate (OS keychain) | Never in files or logs |
| HTTP | `reqwest` on hyper, HTTP/2, rustls | Pooled, pre-warmed |
| Local models (opt-in) | llama.cpp server or ONNX Runtime | Loaded on demand, unloaded after 60 s idle |
| Config | JSONC with a JSON Schema | Written by the Settings window and `:set` |

Dependencies follow `#dependency-policy`.

## Processes

1. **UI (webview).** Renders only what is visible. Handles every keystroke locally (under 1 ms). Never blocks on the network.
2. **Core (main process).** Document model, journal and autosave, job scheduler, AI layer, retrieval, settings, keychain.
3. **Parse worker (sandboxed child process).** Reads one untrusted file: PDFium, OOXML, layout, crops. No network, read access to that file only, memory and time limits. Exits when done.
4. **Model worker (sandboxed child process, opt-in).** Local document model and local embeddings. Starts on demand, exits after 60 s idle.

IPC: Tauri commands for requests; Tauri channels for streams (tokens, progress). Images go through a custom `lecter://` protocol served by the core from a content-hash cache, never through JSON or the JS heap. The contract (generated TypeScript bindings, validation, error codes, worker protocol, `state.db`, journal) is `18-contracts.md`.

## Repository layout

```
lecter/
├── Cargo.toml            # workspace
├── crates/
│   ├── core/             # course, lecture, blocks, journal, jobs, settings, keychain
│   ├── parse/            # parse worker binary + library: pdf, pptx, images, layout, builds
│   ├── models/           # model worker: local document model, local embeddings
│   ├── index/            # tantivy, vectors, retrieval tiers, course card, digest
│   ├── ai/               # provider adapters, agent loop, roles, tools, caching, figures
│   ├── cas/              # LaTeX → expression, numeric step checks
│   ├── harness/          # `lecter-harness`: the core as JSON over the command line, for tests and agents; never shipped
│   └── cli/              # `lecter` CLI (v1; crate stub only in v0)
├── app/                  # Tauri shell (src-tauri): commands, channels, protocol, windows
├── ui/                   # SolidJS + CodeMirror front end
├── tests/                # e2e (WebdriverIO, real app), fixtures, corpus, perf, fake provider
├── docs/                 # this spec, design/, features.json, PROGRESS, DECISIONS, QUESTIONS
└── scripts/              # init, loop, feature tools, hooks
```

Allowed dependencies between Lecter crates (`scripts/check_arch.py` fails the lint stage on any other edge):

| Crate | May depend on |
|---|---|
| `core` | `parse` and `models` with only their `proto` feature (worker message types) |
| `index` | `core` |
| `ai` | `core`, `index`, `cas` |
| `app` | `core`, `ai`, `index`, `parse` (`proto`) |
| `harness` | `core`, `ai`, `index`, `parse` |
| `parse`, `models`, `cas` | no Lecter crate |
| `cli` (v1) | `core`, `ai`, `index` |

`parse` and `models` run as separate binaries and talk to `core` over stdin/stdout (`18-contracts.md#worker-protocol`).

## Debug-only test hooks

Debug builds (`#[cfg(debug_assertions)]` or the `test-hooks` cargo feature, never both off in tests) add, and release builds never contain:

- the embedded WebDriver server (`tauri-plugin-wdio-webdriver`) so WebdriverIO can drive the real app on all three OSes;
- `LECTER_TEST_PICK=<path>`: the next native file or folder dialog returns this path instead of opening (WebDriver can't see native dialogs);
- `LECTER_TEST_TRUST=1`: the folder-trust screen is answered "Trust";
- `LECTER_TEST_HOME=<dir>`: config, data and cache folders live under this directory;
- devtools.

`release-check` in CI proves the release binary has none of them (`16-ci-cd.md`).

## Dependency policy

The one place this is defined. The `add-dependency` skill and `scripts/add_dep.py` apply it.

- **Licences:** MIT, Apache-2.0, BSD-2/3, ISC, Zlib, MPL-2.0, Unicode, CC0. Never GPL, LGPL (static), AGPL, SSPL or "non-commercial" terms. Enforced by `cargo-deny` and the npm licence check.
- **Agents may add** small pure-Rust crates and JS packages within the licence policy, with a D-entry (why, size, licence, alternative rejected).
- **The maintainer approves first** (the builder reports `NEEDS_MAINTAINER`): anything native (ONNX Runtime, PDFium builds, `-sys` crates, system libraries), anything that adds more than 30 crates to `Cargo.lock`, or more than 100 KB gzipped to the UI bundle. `scripts/check_deps.py` enforces this: such a change needs a commit trailer `Deps-Approved: D-0NN` naming the maintainer's D-entry.
- Prefer the standard library and crates already in the tree. Shared versions go in root `[workspace.dependencies]`. Lockfiles are committed.

## Document model

- The lecture `.md` file is the truth. In memory: a rope (`ropey`) plus a block index (id → range, kind, slide, metadata).
- Block ids are stable short ids (`s4b2` for slide 4 block 2, `g-7f3a` for glosses, `n-91c0` for own notes). Glosses attach to ids, never to line numbers.
- Parse metadata (page, box, method, confidence, crop hash) lives in `.lecter/state.db`, keyed by block id. It is never in the `.md`.
- **Journal**: every edit is appended to `.lecter/journal/<lecture>.log` within 250 ms. The `.md` is rewritten with write-to-temp, fsync, then atomic rename, debounced to 1 s. On start, the journal replays anything newer than the file.
- **Slide updates**: if a slide file changes, blocks are re-parsed and glosses re-attached by fuzzy text match. Orphans are listed for the user.

## Job scheduler

One priority queue in the core: user-initiated AI request > parsing the visible slide > parked doubts > indexing > figure cards > background work. Each provider has its own concurrency limit and rate-limit backoff (honour `retry-after`, exponential backoff with jitter). Jobs persist in SQLite and resume after a restart. Every job can be cancelled.

## App identity and migration

The bundle identifier is `io.github.jaykuroor.lecter` (D-030). It may change once Jay has a domain, so nothing the user owns may depend on it.

- **One source.** The identifier appears only in `app/tauri.conf.json`. Rust reads it at build time into `lecter_core::identity::APP_ID`; nothing else spells it out.
- **Stable names for user data.** Every path and secret derives from `identity::APP_DIR_NAME = "lecter"` and `identity::KEYCHAIN_SERVICE = "lecter"`, never from the identifier. Tauri's identifier-based path helpers (`app_config_dir`, `app_data_dir`, …) are banned (clippy `disallowed_methods`).

  | | Linux | macOS | Windows |
  |---|---|---|---|
  | Config | `~/.config/lecter` | `~/.config/lecter` | `%APPDATA%\lecter` |
  | Data | `~/.local/share/lecter` | `~/Library/Application Support/lecter` | `%LOCALAPPDATA%\lecter\data` |
  | Cache | `~/.cache/lecter` | `~/Library/Caches/lecter` | `%LOCALAPPDATA%\lecter\cache` |

- **No state in the webview.** The webview's storage folder is keyed by the identifier, so the UI keeps nothing durable in localStorage, IndexedDB or cookies. All state lives in core-owned files.
- **Installers survive a rename.**
  - Windows: the WiX `upgradeCode` is a fixed GUID, recorded in DECISIONS.
  - The NSIS install folder uses the product name.
  - The updater endpoint and its public key don't depend on the identifier.
- **Migration hook.** `identity::LEGACY_APP_IDS` lists earlier identifiers; it is empty in v0. On start, `identity::migrate()` runs once (recorded in `state.db`) and moves anything found under a legacy location to the stable one: old webview data is discarded, keychain items are re-saved under `lecter`. A rename is then one line plus a release note.

## Packaging

macOS 13+ (Apple Silicon and Intel; signed and notarized `.dmg`), Windows 10/11 (x64 and ARM64; signed installer), Linux x64 and ARM64 (AppImage, Flatpak, `.deb`, `.rpm`). Signed auto-updates. Runs well on an 8 GB laptop with no dedicated GPU.
