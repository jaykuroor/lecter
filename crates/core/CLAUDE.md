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

