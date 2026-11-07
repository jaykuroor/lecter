# lecter-core

Owns course and lecture files, the document model, journal and save, job scheduler, settings, keychain, file watching, trust.
Spec: `01-architecture.md#document-model`, `#job-scheduler`; `02-course-folder.md`; `03-lecture-files.md`; `12-settings-theme-onboarding.md#settings`; `13-security.md`.

## Invariants (never break)

- The lecture `.md` file is the truth. Round trip is lossless: parse → serialise gives byte-identical output for any file we wrote, and preserves unknown content in files we didn't write. Keep a property test for this.
- Edits reach the journal within 250 ms. Saves are write-temp → fsync → atomic rename, debounced 1 s. On start, replay the journal entries that are newer than the file. Kill -9 must lose at most 250 ms of typing.
- Glosses anchor to block ids (`s4b2`, `g-7f3a`, `n-91c0`), never line numbers. Ids are stable across edits and re-parses.
- Parse metadata lives in `.lecter/state.db`, never in the `.md`.
- Settings precedence: per prompt > role file > course > global > default. Unknown keys are kept and reported, never deleted. The JSON Schema is generated from the Rust types (`schemars`), so never hand-edit it.
- Config folders: `~/.config/lecter` (or `$XDG_CONFIG_HOME/lecter`) on Linux and macOS, `%APPDATA%\lecter` on Windows. Data and caches come from the `directories` crate.
- Paths: canonicalise, then require them to stay under the course root. Test Windows separators, UNC paths, symlinks out of the course, and `..`.
- Secrets only via `keyring`. Nothing secret in SQLite, JSONC or logs.
- The scheduler is a single priority queue (user AI > visible-slide parse > doubts > indexing > figure cards > background), with per-provider concurrency and backoff. Jobs persist in SQLite and are cancellable.

## Test commands

`cargo nextest run -p lecter-core` · journal crash test: `cargo test -p lecter-core --test journal_crash -q`

## Learned
- Doc comments land in the rlib's metadata even in release: spell `LECTER_TEST_*` only in docs of items gated by `cfg(any(debug_assertions, feature = "test-hooks"))` (F-015)
- Watch a settings file's folder, not the file: editors save by renaming a temp file over it, which ends an inotify watch on the file; and notify reports opens as `Access(Open)`, so a watcher that re-reads on every event of a file it reads loops forever: skip `Access` except `Close(Write)` (settings/watch.rs) (F-030)
- `settings.schema.json` is regenerated with `LECTER_WRITE_SCHEMA=1 cargo test -p lecter-core settings_schema`; enum variants with doc comments come out as `oneOf`/`const`, not `enum` (settings/keys.rs reads both) (F-030)
- First run means no `config.jsonc`, not no config folder: the settings watcher creates the folder on every start (`AppDirs::run_state`, paths/first_run.rs) (F-031)
- A test that chmods a folder read-only must keep the test home removable even when killed (mutation runs time tests out): lock an empty subfolder, never the course root, or `.verify/mutants-tmp` is left behind and the next run fails (F-021)
- The trust fingerprint must hash an empty or missing `settings` in course.jsonc like no course.jsonc at all (course/trust/survey.rs), or saving course details into a new file asks the trust question again (F-034)
- A test that writes a script and then runs it can fail with "Text file busy" (ETXTBSY) when another test thread forks while the script is open for writing; spawn through a retry on `ExecutableFileBusy` (theme/gtk/monitor.rs `spawn`) (F-043)
- `scripts/check_tests.py` finds a test's body by the first `{` after `fn name`: a proptest strategy written inline with `{0,40}` hides the body ("asserts nothing"); keep strategies in `const`s (theme/gtk/css_tests.rs) (F-043)
- `PR_SET_PDEATHSIG` fires when the spawning *thread* exits, not the process: spawn long-lived children from async runtime worker threads, never from a `spawn_blocking` thread (pool threads exit when idle) (theme/gtk/monitor.rs) (F-043)
- Clippy's allow-unwrap-in-tests recognises only a plain `#[cfg(test)]` module: `#[cfg(all(test, unix))]` makes every test `unwrap` an error; keep `#[cfg(test)]` and gate inside with `#![cfg(unix)]` (theme/gtk/monitor_tests.rs) (F-043)
- The trust fingerprint covers course.jsonc `settings`, so a course-scope settings write asks the trust question again; Lecter's own write keeps it only when nothing else changed (`trust::begin_own_settings_write`/`finish_own_settings_write`, compare-and-set under the trust store's lock), anything else still asks (F-045)
