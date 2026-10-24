@AGENTS.md

## Claude Code specifics

- **Sandbox and hooks are on** (`.claude/settings.json`). Bash runs in Claude Code's sandbox with a narrow network and command allowlist. If a hook or the sandbox blocks you, read the message and follow it; don't work around it.
  - SessionStart prints the build state and your next feature. Don't run `next.py` again unless the state changed.
  - The guard blocks the spec, `features.json`, protected checks, kit files, dependency adds, live keys, pushes and destructive git.
  - Edits are auto-formatted. Stop runs a secret scan, and in loop runs refuses to end until work and PROGRESS are committed.
- **Skills:** `verify` (run and narrow checks), `spec-check` (criteria → tests), `drive-app` (run the real app, screenshots, evidence), `handoff` (PROGRESS/DECISIONS/QUESTIONS formats), `add-dependency`.
- **Subagents:** `reviewer` and `security-reviewer` (fresh-context review before done), `builder` (orchestrator only), `gardener`, `Explore`.
- **Run modes:** `PROMPT.md` (one feature, then stop), `PROMPT.orchestrate.md` (Jay's session dispatches builders), `scripts/loop.sh` (headless, sequential).
- Use a task list for the feature's steps; it survives compaction.
