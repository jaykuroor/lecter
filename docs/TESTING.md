# Testing guide

How to add tests to Lecter so they run locally and in CI without anyone touching a workflow file. Budgets and test layers: `docs/spec/14-quality.md`. Pipelines: `docs/spec/16-ci-cd.md`.

## Rules for every test

- **Proves a behaviour.** Name it after the behaviour: `reattaches_glosses_after_slide_reorder`, not `test_parse_3`. Bug fixes get a regression test named `regression_<feature or issue>_<behaviour>`.
- **Hermetic.**
  - No network: providers are faked.
  - No real config folders: point `XDG_CONFIG_HOME`, `APPDATA` and the data and cache dirs at a temp dir. Use the `TestEnv` helper once it exists.
  - No reliance on the developer's installed themes or fonts.
- **Deterministic.**
  - Seed every RNG.
  - Inject time through the core's `Clock` trait. Never call `SystemTime::now()` in logic under test.
  - No sleeps for synchronisation: wait on an event, or poll with a deadline helper.
- **Parallel-safe.** Tests run concurrently (nextest, Vitest workers, Playwright workers). No shared files, ports or globals; take ports from the OS (`:0`).
- **Fast.** A unit test should take under 100 ms. The whole Rust suite should take under 3 minutes on CI. Slow checks belong in nightly.
- **Strict.** No retries hide flakiness (Playwright `retries: 0`, no nextest retries). A flaky test is a bug in the test or the code: fix it. Never skip, `#[ignore]`, `.skip`, `.only` or loosen a threshold to get green: `scripts/check_tests.py` fails the lint stage on all of these (`14-quality.md#protected-checks`).

## Tests that catch bugs

A test earns its place only if a wrong implementation would make it fail. Agent-written tests often don't: they mock the code they claim to test, compare the code's output with itself, or only check that nothing crashed. These rules apply to every new test; the reviewer applies them and counts a breach as `major`.

- **Ask of every test: would a wrong implementation still pass?** If an off-by-one, a flipped condition or an early `return Default::default()` would still pass, the test is too weak. Mutation testing (below) asks this mechanically.
- **Expected values come from outside the code under test:** the spec, a literal you worked out by hand, or a gold file. Never compute the expected value by calling the function under test, its helpers, or a copy of its logic.
- **Assert the value, not that there is one.** `is_ok()`, `is_some()`, `toBeDefined()`, `toBeTruthy()` and `not.toBeNull()` alone prove almost nothing: assert what the value is. A test that asserts nothing, asserts a constant (`assert!(true)`, `expect(1).toBe(1)`) or compares a value with itself fails the lint (`scripts/check_tests.py`). A rare deliberate exception needs a `Test-Smell-Ok: <path>::<name> - <reason>` trailer the reviewer accepts.
- **Edge cases for every criterion.** A criterion with an input, a limit or an error path gets at least one bad-input or limit+1 test, not only the happy path. Put similar cases in one table-driven test (`rstest` cases, `test.each`) instead of near-copies.
- **Test behaviour, not wiring.** Go through the public interface. Don't assert private fields, call order, exact log text or a constant's value unless the spec states it. Such tests break on every refactor and catch no bugs.
- **New snapshots are read, not rubber-stamped.** Check each new snapshot against the spec or a gold file before committing it, and list it in your report. A snapshot over 200 lines gets split, or replaced by targeted asserts on the parts the criterion is about.
- **Red for the right reason.** The failing run you save as evidence must fail on an assertion, not on a compile error or a missing function. For a new function, first stub it to return a wrong value (`Default::default()`, an empty list), watch the test fail on the assertion, then implement.

### Mocking

Prefer, in order: the real code, a fake (an in-memory implementation that behaves correctly), a spy, a mock.

- **Mock only at the edges:** the network (the fake provider), the OS keychain, the clock (`Clock`), the file system (temp dirs through `TestEnv`) and child processes.
- **Never mock** the module under test, pure functions, value types or data structures. Build real values instead.
- A criterion about core behaviour needs a Rust, harness or real-app test. A Playwright test against the mocked core proves the UI only.
- The lint warns when a changed test file has more than 3 mocks; the reviewer reads the warning (`.verify/test-smells.txt`).

### Mutation testing

`scripts/verify.sh` (the default set, before `feature.py done`) runs `scripts/mutants.py`: cargo-mutants on the Rust lines the feature changed and Stryker on the changed `ui/src` lines, capped at about 10 minutes (`LECTER_MUTANTS_MINUTES`). Each mutant is a small deliberate bug, such as `>` turned into `>=` or a function returning a default. A mutant that survives means no test noticed that bug.

- For each `SURVIVED` line in `.verify/mutants.log`, add or sharpen a test so it fails on that mutant, then re-run `python3 scripts/mutants.py`.
- Only when no test could ever tell the mutant from the original (an equivalent mutant, for example `>` vs `>=` where the two values can never be equal), add a commit trailer `Mutant-Equivalent: <file> - <mutation as printed> - <why>`. The reviewer checks every one. "Hard to test" is not a reason.
- A run cut off by the cap says `CAPPED` and passes; the nightly full run covers the rest and reports the score.
- Diffs that only touch tests produce no mutants. Mutation testing never calls a real provider; it reruns the same hermetic tests.

## Where each kind of test goes

| Kind | Location | Runner (auto-discovered) | CI stage |
|---|---|---|---|
| Rust unit | `#[cfg(test)] mod tests` at the bottom of the file under test | nextest | `test` (3 OSes) |
| Rust integration | `crates/<crate>/tests/<area>.rs` | nextest | `test` |
| Property | `crates/<crate>/tests/prop_<area>.rs` with `proptest` (256 cases; nightly sets `PROPTEST_CASES=4096`) | nextest | `test`, `full` |
| Snapshot | `insta` snapshots next to the test (`snapshots/`) for parser and prompt-assembly outputs | nextest | `test` |
| Benchmark | `crates/<crate>/benches/<area>.rs` (criterion) | `cargo bench` (manual) | none; budgets cover CI |
| Fuzz target | `crates/<crate>/fuzz/fuzz_targets/<name>.rs` + seed corpus `fuzz/corpus/<name>/` | `cargo fuzz` | `nightly/fuzz` |
| UI unit | `ui/src/**/<name>.test.ts(x)` (Vitest + `@solidjs/testing-library`) | Vitest | `test` |
| UI end-to-end | `ui/e2e/<flow>.spec.ts` (Playwright against the mocked core) | Playwright | `e2e`; tagged `@smoke` also in local verify |
| Real-app end-to-end | `tests/e2e/flows/<flow>.ts` (WebdriverIO + embedded WebDriver, debug builds) | `scripts/e2e-app.sh` | `e2e-app` (3 OSes) |
| Harness | `crates/harness/tests/<area>.rs` calling `lecter-harness` commands | nextest | `test` |
| Parse corpus | `tests/corpus/<category>/<file>` + gold `tests/corpus/expected/<file>.md` | corpus scorer | `test` (public files only) |
| Fake-provider scenario | `tests/fake-provider/scenarios/<name>.json` | used by Rust and e2e tests | `test`, `nightly/chaos` |
| Perf budget | `tests/perf/budgets.json` entry + measurement script | `tests/perf/budgets.sh` | `perf` |
| AI eval item | `tests/ai-eval/questions.jsonl` line | `scripts/live.sh F-0NN -- …` only | manual |

## Recipes

### A Rust test

1. Put it next to the code (unit) or in `crates/<crate>/tests/` (integration across modules or with fixtures).
2. Use `Result`-returning tests (`fn x() -> Result<()>`) instead of `unwrap()` chains.
3. Run just it: `cargo nextest run -p lecter-<crate> <name>`.

### A property test

Use one for anything with a round trip or an invariant: Markdown ↔ blocks, journal replay, anchor stability, settings precedence, path normalisation.

```rust
proptest! {
    #[test]
    fn markdown_round_trip_is_lossless(doc in arb_lecture()) {
        prop_assert_eq!(serialize(&parse(&doc)?), doc);
    }
}
```

When proptest finds a failure, commit the generated `proptest-regressions/` file. It replays forever.

### A snapshot test

Use `insta::assert_snapshot!` for structured outputs such as parsed slides or assembled prompts. New snapshots are fine. Inspect changes with `cargo insta pending-show` (the `review` command is interactive, so agents don't use it), then `cargo insta accept`. Accept a changed snapshot only when the spec says the new output is right, with a commit trailer `Snapshot-Changed: <path> - <reason>`; the reviewer judges the reason, and the lint fails a changed snapshot without one. Prompt-assembly snapshots double as the prompt-cache stability check: an unexpected diff means a cache miss for every user.

### A UI end-to-end test

1. Create `ui/e2e/<flow>.spec.ts`. Start from a fixture course served by the mocked core in `ui/e2e/mock-core/`.
2. Locate by role and label (`getByRole('button', { name: 'Ask' })`), never by CSS class.
3. Drive keys with `page.keyboard.press('Space')`, `type('mm')` and so on, exactly as `10-keymap.md` lists them. Also test the mouse path for the same action.
4. Add `@smoke` to the title only for the few flows that prove the app is alive (open course, open lecture, ask, save). The smoke set must stay under 60 s and runs in Chromium only, so it works on any Linux distro. The full suite in CI adds WebKit.
5. Run it with `pnpm -C ui exec playwright test e2e/<flow>.spec.ts --reporter=line`.

### A real-app flow

1. Create `tests/e2e/flows/<flow>.ts`. Use the fixtures under `tests/fixtures/`, and `shot('<state>')` at each state the criteria name.
2. Native dialogs are answered by `LECTER_TEST_PICK` and `LECTER_TEST_TRUST` (debug builds only).
3. Run it: `xvfb-run -a scripts/e2e-app.sh <flow> --evidence F-0NN` (drop `xvfb-run -a` with a display). Details: `.claude/skills/drive-app/SKILL.md`.

### A fixture

- Put it under `tests/fixtures/`.
- Keep it as small as possible. Prefer a generator script (`tests/fixtures/gen/*.py` or a Rust test helper) over binary blobs.
- A binary fixture is at most 200 KB. Record its licence in `tests/fixtures/LICENSES.md`.
### Private lecture files (confidential)

The maintainer's real lecture files (the private test corpus) live only in `tests/corpus/private/`, which git ignores. They arrive as an unzipped bundle containing `inbox/` and `MANIFEST.json`.

- **What the manifest gives you:** ids (`P-01` …), page counts, text-layer statistics and a `kind_guess`: `slides`, `slides-annotated`, `dense-text` or `handwritten-or-scan`.
- **Allowed:**
  - local tests and spikes that read these files;
  - gold files in `tests/corpus/private/expected/`;
  - snapshots of their parse output in `tests/corpus/private/snapshots/`.
- **Results:** report only aggregate numbers and manifest ids (`P-09 CER 4.1%`).
- **Never:** commit them; copy them out of that folder; quote their text; name them in tracked files, logs, commit messages or DECISIONS; use them in the tutorial, fixtures, README or snapshots outside the private folder.
- **Enforcement:** `scripts/check_private.py` (lint stage), the guard hook and `.gitignore` enforce this. Don't work around them.
- **Finding the folder:** test helpers find it via `LECTER_PRIVATE_CORPUS` (an absolute path), falling back to `<repo>/tests/corpus/private`. Builder worktrees symlink the main checkout's folder.
- **When the folder is absent** (CI, or another developer's machine), tests that need it print `SKIP (no private corpus)` and pass. This is the one allowed skip, and it is never a reason to call a feature done.
- **Live runs** with private files send their content to the maintainer's own provider account. That's allowed for spikes and the AI eval only, through `scripts/live.sh` (D-035). Results are never published.

### A parse-corpus case

1. Add the file under `tests/corpus/<category>/`. Categories: `text-pdf`, `pptx`, `scan`, `math`, `chart`, `handwriting`, `builds`.
2. Write the gold Markdown in `tests/corpus/expected/`.
3. The scorer reports CER, LaTeX exact match and render-back score per category, against `tests/corpus/thresholds.json`.
4. Raise thresholds when quality improves. Lowering one needs the maintainer's D-entry and a `Budget-Changed: <key> - D-0NN` trailer (`thresholds.json` is protected).

### A fake-provider scenario

A scenario is a JSON list of timed events: `{ "after_ms": 1200, "sse": "..." }`, `{ "status": 429, "retry_after": 2 }`, `{ "drop": true }`. Name it after the failure it simulates (`slow_first_token_3s.json`). Rust tests start the fake provider in-process from `tests/fake-provider` (crate `lecter-fake-provider`). E2E and chaos runs start its binary.

### A fuzz target

1. Add a target for every parser of untrusted input, with 5–20 small seed files.
2. When nightly finds a crash:
   - copy the input into `tests/fixtures/fuzz-regressions/<target>/`;
   - add a regression test that parses it;
   - fix the bug.

### A performance budget

1. Add an entry to `tests/perf/budgets.json` (protected: only a feature that lists it under `protected` may edit it): `{ "id": "keystroke_p99_ms", "budget": 8, "unit": "ms", "kind": "timing", "script": "tests/perf/keystroke.ts" }`.
2. Write the script so it prints one JSON line with the measured value.
3. `kind: timing` gets the ×1.5 CI allowance; `memory`, `tokens` and `count` do not.
4. Never raise a budget to pass. Measure, report it, and ask the maintainer; a loosened budget needs their D-entry and a `Budget-Changed: <id> - D-0NN` trailer.

### A live AI eval question

Add a line to `tests/ai-eval/questions.jsonl` with `{ "id", "course", "lecture", "anchor", "role", "question", "reference", "rubric" }`. The eval runs only through `scripts/live.sh`, which loads the keys for that one command and applies the free-tier rate limits. It logs tokens, TTFT and accuracy per provider into `tests/ai-eval/results/` (git-ignored).

## When a test fails in CI but not locally

The most common causes, in order:

1. **Windows paths and CRLF.** Use `Path` APIs and `.gitattributes`; never compare paths as strings.
2. **macOS case-insensitive filesystem.**
3. **Missing system packages on the runner.**
4. **Timing on slow runners.** Use a deadline helper, not a sleep.
5. **Test order dependence.**

Reproduce with `gh run view <id> --log-failed`. Fix the cause, add a regression test if it was a code bug, and note the gotcha in the nearest `CLAUDE.md` `## Learned`.

## Live keys

Live spikes and the AI eval (cards with `needs: ["live-keys"]`) call real providers with the maintainer's own keys. Agents never see them, and every other test uses the fake provider.

1. Create the file once, outside the repo. Never `source` it or export a key before starting `claude` (the session-start hook warns if it sees one):
   ```bash
   mkdir -p ~/.config/lecter-dev && chmod 700 ~/.config/lecter-dev
   printf 'GEMINI_API_KEY=...\n' > ~/.config/lecter-dev/keys.env && chmod 600 ~/.config/lecter-dev/keys.env
   ```
   Use the variable names the provider adapters read (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). `LECTER_KEYS_FILE` points `scripts/live.sh` at another path.
2. Once the file exists, `next.py` shows the live-keys cards as ready. Each live command is `scripts/live.sh F-0NN -- <cmd>`: it loads the file into that one command only, runs outside the sandbox, logs what ran to `.verify/live-runs.log` (never the keys), and asks the maintainer to approve every run.
3. Rate limits default to a free tier (8 requests a minute, 200 a day, 200k tokens a minute). Add `LECTER_LIVE_RPM=`, `LECTER_LIVE_RPD=` or `LECTER_LIVE_TPM=` lines to the file to change them.
