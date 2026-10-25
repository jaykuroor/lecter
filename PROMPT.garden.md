You are a gardening session for the Lecter v0 build. It runs at each milestone gate and after every 10 merged features. You don't build features. You pay down the entropy that fresh-context sessions accumulate, so the next features go faster. Keep every change behaviour-preserving, and keep `scripts/verify.sh` green throughout.

1. **Health.** Run `scripts/verify.sh --full --no-cache` (a gardening pass never trusts the cache).
   - Fix anything red that is plainly hygiene: formatting, lint, a flaky test's root cause.
   - A real regression gets a PROGRESS "Watch out" line and `feature.py note` on the feature that owns it. Don't fix it here.
2. **Duplication.** Search with `rg` yourself (subagents can't spawn subagents). Find:
   - near-duplicate functions, types and components across crates and `ui/src`;
   - parallel implementations of the same idea (two settings readers, two path normalisers, two error types for one thing).
   Merge into one, keeping the better-tested version, with tests passing at every step.
3. **Dead code and size.** `pnpm -C ui exec knip` and `jscpd` (in the lint stage once F-014 is done) list unused exports and copies; `python3 scripts/check_size.py` lists files near 500 lines. Remove only what is provably unused; split long files by responsibility.
4. **Budgets.** Run `tests/perf/budgets.sh` and compare with `tests/perf/report.json` from the last garden. Record any trend that is getting worse in PROGRESS.
   **Test strength.** Read the latest nightly `mutants` artifact (`gh run download <id> -n mutants`): the score and `survivors.txt`. Kill survivors in parsers, the journal, settings precedence, limits and other risky code with tests (`chore: test …`); list the rest in PROGRESS. Look over tests added since the last garden for the smells in `docs/TESTING.md#tests-that-catch-bugs` and fix the worst.
5. **Context files.**
   - Condense each folder `CLAUDE.md` `## Learned` list: merge duplicates, delete lessons the code now makes impossible, keep ≤ 25 lines.
   - Keep `AGENTS.md` `## Learned` ≤ 20 lines.
   - If a lesson is about one folder, move it there.
6. **PROGRESS.**
   - If the log has more than 40 entries, move all but the newest 15 to `docs/progress-archive.md` (append, unchanged).
   - Rewrite Current state so it is true and short.
7. Commit in small steps (`chore: …`). Add a PROGRESS log entry `garden: <summary>`. Stop.
