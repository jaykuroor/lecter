# Changelog

All notable changes to Lecter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (`0.x` while v0 is in development; each completed milestone is a minor release).

## [Unreleased]

### Added
- Project skeleton: the Rust workspace and a `lecter` command that prints its version (F-010)
- UI scaffold: the app shell runs in a browser against a mocked core (`pnpm -C ui run dev`) (F-011)
- Lecter opens as a desktop window (Tauri 2), locked down to the one command it uses; `scripts/dev.sh` runs it with hot reload (F-012)
- CI checks every push and pull request on Linux, macOS and Windows; Dependabot proposes weekly grouped updates (F-013)
- `lecter-harness`, a debug-only command-line tool that prints core results as JSON for tests and agents (F-015)
- Developers can drive the real Lecter app end to end with WebdriverIO (`scripts/e2e-app.sh`); CI checks that release builds carry none of the test tooling (F-016)
- The UI's types for talking to the core are generated from the Rust code, and oversized requests are refused before they reach a command (F-017)
- Open a course folder from the rail (mouse, or Enter/Space on the button) and see its lectures and slides; files linked from outside the course are refused (F-018)
- `lecter-harness parse <pdf>` turns a text PDF into blocks through a separate parse process; a crash or hang marks the file as failed and the app keeps running (F-019)
- Open a lecture from the course rail and move through its slides with Vim keys (j, k, gg, G; i and Esc) (F-020)
- Notes are journaled as you type and saved automatically; reopening after a quit or a crash keeps your typing (F-021)
- Search your opened lectures with `:find words` or the Find field in the side panel (F-022)
- Press `a` on a slide line to ask about it: an answer streams in under the line, is saved in the lecture, and Esc stops it (a sample answer until a provider is connected) (F-023)
- Answers that include a function plot now show the plot inside the answer, computed on your computer; ask the sample "can you plot this?" to try it (F-024)
- `:find` finds hits again after the course's cache folder is deleted while Lecter is open (CI-f9e26bc)
- The caret stops blinking 10 s after you stop typing (and never blinks with reduced motion on), so an open lecture uses no CPU while idle; clicking a slide line now puts the cursor on that line (F-029)
- An open lecture left idle no longer keeps the CPU busy: the editor's hidden text caret stops blinking 9 s after your last key or click (F-180)
- Performance budgets (speed, memory, size) now gate every push on Linux, macOS and Windows, counting each process's memory by its fair share (F-025)
- The app window and the first lecture appear sooner after launch, and the app logs how long each startup step took (F-179)

