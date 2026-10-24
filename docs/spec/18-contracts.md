# 18 · Contracts: IPC, storage formats, errors

The interfaces between the UI, the core, the workers and the disk. Each is defined once, in Rust, and everything else is generated from it or tested against it. Change a contract only together with its version number and a migration or compatibility test.

## IPC

### Rules

- Every Tauri command and event is a Rust function or type in `app/src/ipc/<area>.rs`, annotated for **tauri-specta** (D-entry from the walking skeleton). The TypeScript bindings are generated into `ui/src/core/bindings.ts` and committed. Nobody edits that file by hand.
- `scripts/verify.sh` (lint stage) regenerates the bindings and fails if the committed file differs (`bindings-stale`).
- The mocked core used by Playwright (`ui/e2e/mock-core/`) implements the generated `Commands` type, so TypeScript fails to compile when the mock drifts from the contract.
- Components never call `invoke` directly; they call the wrappers in `ui/src/core/` (`09-ui.md`).
- Requests are commands. Streams (tokens, parse progress, job updates) are Tauri channels typed as `Channel<Event>`. Images never cross IPC: they go through `lecter://` (SEC-33).
- Names: commands `area_verb_object` in snake_case (`lecture_open`, `gloss_regenerate`); events `area:event` (`job:progress`).

### Validation

Every command validates its arguments in Rust before doing anything (SEC-32):

| Input | Limit (setting `limits.ipc.*`) |
|---|---|
| Any single string | 64 KB (prompt text 16 KB; search query 1 KB) |
| Any list | 10,000 items |
| Whole payload | 1 MB |
| Paths | canonicalised; must stay under a trusted course root or be a path the user picked in a dialog this session |
| Ids | must match their pattern (`s\d+b\d+`, `g-[0-9a-f]{4,8}`, `n-[0-9a-f]{4,8}`) |

A violation returns `E_INVALID_ARGUMENT` and is logged without its content.

### Commands and events per area (v0)

| Area | Commands | Events / channels |
|---|---|---|
| app | `app_info`, `app_quit` | `app:ready` |
| settings | `settings_get`, `settings_set`, `settings_schema`, `settings_source` | `settings:changed` |
| course | `course_list`, `course_open`, `course_trust`, `course_details_save`, `course_reorder` | `course:changed` |
| lecture | `lecture_new`, `lecture_open`, `lecture_rename`, `lecture_apply_edits`, `lecture_close` | `lecture:external_change` |
| parse | `parse_enqueue`, `parse_fix_block`, `parse_report` | channel `ParseProgress` |
| search | `search_course`, `search_find` | none |
| ai | `gloss_request`, `gloss_cancel`, `gloss_regenerate`, `gloss_rate`, `gloss_variant`, `note_action_undo` | channel `GlossStream` |
| providers | `provider_list`, `provider_connect`, `provider_test`, `provider_sign_in`, `models_list` | `provider:status` |
| figures | `figure_propose_answer`, `figure_render` | channel `FigureProgress` |
| jobs | `jobs_list`, `job_cancel` | `job:progress` |
| usage | `usage_summary`, `budget_get` | `budget:reached` |

A feature that adds a command adds it to this table in its planning pass (the spec is read-only in build sessions; a missing command is a Q-entry).

### Error codes

Commands return `Result<T, IpcError>`; `IpcError` is `{ code, message, retryable, detail? }` where `message` is user-facing English and `detail` never holds content or secrets. The UI must handle every code:

| Code | Meaning | UI behaviour |
|---|---|---|
| `E_INVALID_ARGUMENT` | Validation failed | Bug: toast "Something went wrong", log it |
| `E_NOT_FOUND` | File, course, lecture or id missing | Inline message with the name |
| `E_NOT_TRUSTED` | Course is read-only or untrusted | Trust prompt |
| `E_CONFLICT` | File changed on disk (ROB-11) | Merge-or-choose dialog |
| `E_LOCKED` | Course open elsewhere (ROB-12) | Take-over prompt |
| `E_IO` | Disk full, read-only, permission (ROB-30) | Banner, keeps retrying |
| `E_PARSE_FAILED` | Worker failed, crashed or hit a limit (SEC-04) | Block shows the reason; "Try vision" action |
| `E_PROVIDER_AUTH` | Key rejected or sign-in expired | "Reconnect" action |
| `E_RATE_LIMITED` | Waiting in the token bucket or on `retry-after` (SEC-10) | Gloss shows "waiting n s" |
| `E_BUDGET` | Spend cap reached (SEC-12) | Ask-to-continue card |
| `E_TIMEOUT` | SEC-14 timeout | Retry action |
| `E_PROVIDER` | Other provider error (5xx, malformed) | Retry action; circuit breaker may skip it |
| `E_CANCELLED` | User or shutdown cancelled | Nothing |
| `E_UNSUPPORTED` | Model lacks a capability | Suggest a model |
| `E_INTERNAL` | Bug | Toast, log, keep running |

## Worker protocol

Core ↔ `lecter-parse` and `lecter-models` speak length-prefixed `postcard` frames over stdin/stdout (JSON in debug builds), defined in `crates/parse/src/proto.rs` (and `crates/models/src/proto.rs`) behind each crate's `proto` feature, with a `PROTO_VERSION` constant. The first frame each way is `Hello { proto_version }`; a mismatch kills the worker and logs an error. Messages: `Parse { path, limits }` → `Progress { page, pages }`* → `Done { blocks, crops, figures }` or `Failed { code, reason }`.

## state.db schema

SQLite in `.lecter/state.db`, WAL mode, `PRAGMA user_version = 1`. Caches and state only; everything here except the tables marked **keep** can be rebuilt from the files (ROB-23).

| Table | Columns (types abbreviated) | Notes |
|---|---|---|
| `meta` | `key TEXT PK, value TEXT` | `migrated_identity`, timestamps |
| `blocks` | `lecture TEXT, block_id TEXT, slide INT, page INT, bbox TEXT, method TEXT, confidence REAL, crop_hash TEXT, PK(lecture, block_id)` | Parse metadata (never in the `.md`) |
| `parse_cache` | `file_hash TEXT PK, parser_version INT, result_path TEXT, created INT` | BLAKE3 of file bytes |
| `jobs` | `id INT PK, kind TEXT, priority INT, state TEXT, payload TEXT, attempts INT, created INT, updated INT` | Persisted scheduler queue |
| `variants` | `gloss_id TEXT, n INT, body TEXT, model TEXT, created INT, PK(gloss_id, n)` | **keep** |
| `ratings` | `gloss_id TEXT, rating TEXT, reason TEXT, created INT` | **keep** |
| `usage` | `id INT PK, ts INT, role TEXT, provider TEXT, model TEXT, input INT, cached INT, output INT, ttft_ms INT, total_ms INT, cost_micros INT` | **keep** (budgets) |
| `model_speed` | `model TEXT PK, ttft_ms_avg REAL, tps_avg REAL, n INT` | Rolling 50 |
| `concepts` | `id INT PK, kind TEXT, label TEXT, source TEXT, anchor TEXT` | Concept map |
| `figures` | `id TEXT PK, lecture TEXT, tier TEXT, source_path TEXT, static_path TEXT` | |

Migrations live in `crates/core/src/db/migrations/NNNN_name.sql` and are applied in order inside a transaction, after the backup in ROB-22.

## Journal records

`.lecter/journal/<lecture-file-stem>.log`: append-only, one JSON object per line, fsync'd in batches at most 250 ms apart.

```json
{"v":1,"seq":1042,"ts":1761200000123,"base":"<blake3 of the .md this applies to>","op":"replace","from":3810,"to":3815,"text":"new words"}
```

- `op` is `replace` (covers insert and delete) or `checkpoint` (the `.md` was saved at `base`; earlier records can be dropped).
- `from` and `to` are UTF-8 byte offsets into the document as of the previous record.
- Replay on start applies every record after the last `checkpoint` whose `base` matches the file on disk. If the base doesn't match (the file changed outside Lecter), the records are kept aside and ROB-11 applies.
- A truncated last line (crash mid-write) is ignored.

## Lecture and course files

Formats: `03-lecture-files.md` (lecture `.md`, front matter `lecter: 1`) and `02-course-folder.md` (`course.jsonc`, `"version": 1`). Settings schema: generated from Rust types (`12-settings-theme-onboarding.md#settings`).
