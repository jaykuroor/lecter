# Changelog

All notable changes to Lecter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (`0.x` while v0 is in development; each completed milestone is a minor release).

## [Unreleased]

### Changed
- CI's speed and memory checks on shared runners now report their numbers instead of failing; they still gate on the maintainer's machine (F-181)

### Added
- On macOS and Windows, Lecter follows your accent colour and offers bundled themes (Adwaita, Yaru, Breeze, Catppuccin, Gruvbox, Nord; light and dark) and GTK themes from ~/.themes (F-044)
- On Linux, Lecter follows your GTK theme, dark mode and accent colour as you change them, and `:set ui.theme <name>` picks an installed GTK theme (F-043)
- Lecter has its own light and dark theme and follows your system's light/dark setting (F-042)
- Ctrl/Cmd-Shift-P opens a command palette listing every command with its keys, and Ctrl/Cmd-P jumps to a course, lecture, list or source by typing part of its name (F-041)
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
- The walking skeleton (open a course, parse slides, edit, restart, search, ask, see a plot) is tested end to end in the real app on Linux, macOS and Windows (F-026)
- The app window and the first lecture appear sooner after launch, and the app logs how long each startup step took (F-179)
- Settings live in JSONC files (global and per course) and apply as soon as you save them; a course folder can't change your privacy, logging, limits or spend caps (F-030)
- Lecter keeps its settings, data and cache in stable "lecter" folders on Linux, macOS and Windows, and knows when it is starting for the first time (F-031)
- Opening a course folder for the first time asks whether to trust it; read-only courses keep notes and slides but turn off AI and search indexing, and a course Lecter can't fully check opens read-only only (F-033)
- After trusting a course, a short form fills in its name, code, term, professor, icon, colour and folders, saved to .lecter/course.jsonc (F-034)
- The course rail lists your courses with their icon and colour; drag them (or Shift-J/K) into the order you like, and Ctrl/Cmd-1…9 switches between them (F-035)
- The course sidebar lists Dashboard, Lectures with their dates, Lists and Sources; j/k and the arrow keys move through it, and Space e or the headerbar button hides it, remembered next time (F-036)
- Keys follow Lecter's keymap everywhere: Space shows every leader group after a short pause, F6 moves between panes, and your own keymaps.jsonc rebinds or unbinds any key (F-037)
- A hint bar above the status line shows the keys that work where your cursor is, and clicking a hint does the same as its key; Space u h switches between full, compact and off (F-038)
- A keystroke overlay shows the keys you type (Space u k hides it), and read mode (Space u r or `:read`) hides everything but the lecture (F-039)
- Type `:` in a lecture for a command line with completion; `:set key=value` changes a setting (checked, then saved) and `:set key?` shows its value and where it comes from (F-040)

