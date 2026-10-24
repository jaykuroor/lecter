---
name: add-dependency
description: How to add a Rust crate or npm package to Lecter. Use whenever you are about to add a dependency; `cargo add` and `pnpm add` are blocked.
---

# Add a dependency

The policy (licences, what agents may add, what needs Jay) is `docs/spec/01-architecture.md#dependency-policy`. This skill is the procedure.

1. **Need.** Is it already in the tree (`grep` the lockfiles), or doable in under ~150 lines with std or existing crates? Then don't add it.
2. **Health.** Maintained in the last 12 months, no open RUSTSEC or npm advisories, features trimmed (`--features` with only what you need).
3. **Add it with the script**, which measures and enforces the policy:
   - Rust: `python3 scripts/add_dep.py rust <crate>[@<ver>] -p lecter-<crate> [--features a,b] [--dev]`
   - UI: `python3 scripts/add_dep.py ui <package>[@<ver>] [--dev]`
   It prints new crates, native crates, licences, or the gzipped bundle growth.
4. **Within policy:** it prints a `Dep-Added:` trailer. Put it in your commit message with the reason and the alternative you rejected, and list the dependency under DECISIONS in your report (the orchestrator writes the D-entry).
5. **Outside policy** (native, > 30 crates, > 100 KB gz, licence): it undoes the change and prints `NEEDS_JAY` with numbers. Report `NEEDS_JAY` with them. Once Jay's D-entry exists, re-run with `--approved D-0NN` and add `Deps-Approved: D-0NN` to the commit.
6. Shared versions go in root `[workspace.dependencies]`. `scripts/check_deps.py` (lint stage) fails any dependency added without its trailer.
