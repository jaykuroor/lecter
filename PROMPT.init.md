You are the first session of the Lecter v0 build. The kit is already here: the spec in `docs/spec/`, the plan in `docs/features.json`, the rules in `AGENTS.md`, the scripts in `scripts/`, and the hooks and sandbox settings in `.claude/`.

Your job is to make the repository real and build F-010 (the Rust workspace), the first stone of milestone M0.

1. Run `scripts/init.sh --check`. If tools are missing, list them with the install hint each one prints, for the maintainer, and stop.
2. If this isn't a git repository yet, run `git init -q -b main`. If it is one but the branch isn't `main`, tell the maintainer. Then make a baseline commit on `main`: `chore: Lecter build kit`. Don't add or change remotes (The maintainer adds `origin`). Pushing follows AGENTS.md.
3. Run `scripts/verify.sh`. It must print `VERIFY OK` with the Rust and UI checks skipped ("arrives with F-010" and so on). If anything fails here, the kit is broken: tell the maintainer exactly what failed and stop.
4. Read `python3 scripts/spec.py 01-architecture.md` once, whole.
5. Build F-010 by following `PROMPT.md` from step 1. Its card has the criteria. Keep the folder `CLAUDE.md` files that already exist. Commit trailers: the workspace's own crates need none; any third-party crate goes through `scripts/add_dep.py`.
6. Hand off and finish as in `PROMPT.md` steps 6–7. The next features (F-011 UI, F-012 Tauri shell, F-013 CI, F-014 code-health gates, then the M0 spikes) are built by `PROMPT.md` or `PROMPT.orchestrate.md`.
