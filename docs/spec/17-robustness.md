# 17 · Robustness

What keeps notes safe and the app responsive when the world misbehaves: other programs edit files, disks fill up, providers change their APIs. Each requirement has an id (`ROB-nn`); features cite the ids they implement. Security requirements are in `13-security.md`.

## File watcher

- **ROB-01** Events are debounced (200 ms) and coalesced per path.
- **ROB-02** The app ignores events caused by its own writes (it records the content hash it wrote).
- **ROB-03** Watching is capped per course: at most 20,000 files and depth 12. Over the cap, Lecter shows a notice and stops watching deeper folders. `node_modules`, `.git`, `target`, `.venv`, `__pycache__` and the `.lecter/cache` folder are never watched or indexed.

## External edits

- **ROB-10** Lecter detects when an open lecture changes on disk (git, Dropbox, OneDrive, iCloud, another editor) by comparing the file's hash with the last one it wrote.
- **ROB-11** It never overwrites such a change silently. If the edits touch different block ids, it merges them by block id and tells the user. Otherwise it shows both versions and asks.
- **ROB-12** A single-instance lock per course (`.lecter/lock`, holding the process id and host) stops two Lecter windows or machines from writing the same course. A stale lock (process gone) is taken over after asking.

## Data versioning

- **ROB-20** Lecture front matter has `lecter: 1`; `course.jsonc` has `"version": 1`; `state.db` has `PRAGMA user_version` (`18-contracts.md#statedb-schema`).
- **ROB-21** Migrations are forward-only, one function per version step, each with a test that migrates a fixture from the previous version. A newer file than the app understands opens read-only with a clear message.
- **ROB-22** Before migrating anything, Lecter copies the original to `.lecter/backup/<name>.<version>.<timestamp>` (the last 5 are kept).
- **ROB-23** On open, `state.db` runs `PRAGMA integrity_check` (quick mode). On corruption, caches are rebuilt from the files. Data that can't be rebuilt (ratings, gloss variants, usage) is exported to `.lecter/backup/` first and restored where possible.

## File-system edge cases

- **ROB-30** Disk full, read-only folder and permission denied give a clear error naming the file, keep the edit in the journal, and lose no data. Saving retries when the condition clears.
- **ROB-31** Windows: paths over 260 characters work (`\\?\` prefixes in the core), and reserved names (`CON`, `NUL`, `COM1`…) and trailing dots or spaces in generated file names are avoided.
- **ROB-32** Unicode: file names are compared after NFC normalisation (macOS may return NFD); lecture text is stored as written.
- **ROB-33** Case-insensitive file systems (macOS, Windows): two names differing only by case are treated as the same file; generated names never collide that way.
- **ROB-34** Cloud placeholders (OneDrive Files On-Demand, iCloud): Lecter never forces a download while scanning a folder; it parses a placeholder only when the user opens it, and shows "downloading…" meanwhile.

## Processes and shutdown

- **ROB-40** Child workers die with the app: Linux `PR_SET_PDEATHSIG`, macOS a parent-watch pipe, Windows a job object with kill-on-close.
- **ROB-41** Shutdown flushes the journal, writes pending saves, cancels jobs and kills workers, within 2 s. A second quit request exits at once (the journal still holds the edits).

## Logs and crash reports

- **ROB-50** Logs rotate daily and at 10 MB, keeping 5 files.
- **ROB-51** Logs are redacted (SEC-62) and local only. A crash report is written locally and sent nowhere; the user can attach it to an issue by hand.
- **ROB-52** File names, paths and error bodies enter logs only as escaped structured fields (`tracing` fields, never interpolated into the message), so a name containing a newline or a terminal escape code can't forge a log line.

## Provider drift

- **ROB-60** Each adapter sends the provider's API version header where one exists (for example `anthropic-version`) and pins it in code.
- **ROB-61** Unknown SSE event types and unknown JSON fields are ignored and counted in the debug log; they never break a stream.
- **ROB-62** When a provider reports a model as retired or unknown, Lecter falls back to the role's next choice or default-fast, tells the user once, and refreshes the catalog.
