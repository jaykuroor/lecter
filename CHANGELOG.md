# Changelog

All notable changes to Lecter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (`0.x` while v0 is in development; each completed milestone is a minor release).

## [Unreleased]

### Added
- Project skeleton: the Rust workspace and a `lecter` command that prints its version (F-010)
- UI scaffold: the app shell runs in a browser against a mocked core (`pnpm -C ui run dev`) (F-011)
- Lecter opens as a desktop window (Tauri 2), locked down to the one command it uses; `scripts/dev.sh` runs it with hot reload (F-012)
