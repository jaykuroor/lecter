@AGENTS.md

## Claude Code specifics

- **Sandbox and hooks are on** (`.claude/settings.json`). Bash runs in Claude Code's sandbox with a narrow network and command allowlist. If a hook or the sandbox blocks you, read the message and follow it; don't work around it.
  - SessionStart prints the build state and your next feature. Don't run `next.py` again unless the state changed.
  - The guard blocks the spec, `features.json`, protected checks, kit files, dependency adds, live keys, pushes and destructive git.
  - Edits are auto-formatted. Stop runs a secret scan, and in loop runs refuses to end until work and PROGRESS are committed.
- **Skills:** `verify` (run and narrow checks), `spec-check` (criteria → tests), `drive-app` (run the real app, screenshots, evidence), `handoff` (PROGRESS/DECISIONS/QUESTIONS formats), `add-dependency`.
- **Subagents:** `reviewer` and `security-reviewer` (fresh-context review before done), `builder` (orchestrator only), `gardener`, `Explore` (only for searches that span several crates; `rg` first).
- **Run modes:** `PROMPT.md` (one feature, then stop), `PROMPT.orchestrate.md` (the maintainer's session dispatches builders), `scripts/loop.sh` (headless, sequential).
- **Pushing is over HTTPS via gh, never SSH** (the sandbox can't read `~/.ssh`). `origin` must be `https://github.com/jaykuroor/lecter.git` with `credential.helper` set to `!gh auth git-credential`; then plain `git push origin main` works (with `LECTER_ALLOW_PUSH=1`). If `origin` is still the `git@github.com:` URL, run the explicit form: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push https://github.com/jaykuroor/lecter.git main:main`. Never switch back to SSH.
- Use a task list for the feature's steps; it survives compaction.
