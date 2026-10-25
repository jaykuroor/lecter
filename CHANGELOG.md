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
