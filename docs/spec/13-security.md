# 13 · Security

Lecter opens files from strangers and sends their text to AI models. The two main risks are a malicious file and a malicious instruction hidden in a file or web page. Answer: parse in a sandbox, cap everything that can grow, and give the AI no ability to act beyond visible, undoable note actions.

Every requirement below has an id (`SEC-nn`). Features cite the ids they implement in their acceptance criteria, and the `security-reviewer` agent checks each touched id. Robustness requirements (data safety, file system, provider drift) are in `17-robustness.md`. Wire formats are in `18-contracts.md`.

## Threats

| Threat | Covered by |
|---|---|
| Hostile PDF, PPTX or image: parser bugs, zip bombs, decompression bombs, XXE | SEC-01 to SEC-05 |
| Prompt injection from slides, sources or web pages | SEC-20 to SEC-24 |
| A shared course folder that loosens settings or redirects data | SEC-25, SEC-27 |
| Script injection or data exfiltration through AI output, notes or exports | SEC-20 to SEC-26, SEC-30 to SEC-33 |
| Runaway cost or a hung app from the network (OWASP LLM10) | SEC-10 to SEC-15 |
| A compromised webview reaching the system through IPC | SEC-30 to SEC-36 |
| Stolen keys or sign-in tokens | SEC-40 to SEC-44 |
| Supply chain, including invented package names | SEC-50 to SEC-54 |
| Privacy leaks | SEC-60 to SEC-62 |

## Untrusted files

- **SEC-01 Sandboxed parse worker.** Parsing runs in the `lecter-parse` child process with no network, read access to its one input file only, a 1 GB memory limit and a 60 s time limit per file. Linux: seccomp + Landlock. macOS: a sandbox profile. Windows: AppContainer, or a restricted token plus a job object. The model worker uses the same sandbox, except that its downloads run in the core.
- **SEC-02 Archive limits.** Zip: at most 200 MB uncompressed, compression ratio at most 100, at most 10,000 entries, no absolute paths or `..` in entry names.
- **SEC-03 XML.** No DTD processing, no external entities, depth at most 256.
- **SEC-04 Size limits** (all settings under `limits.*`, with these defaults): file 500 MB; 2,000 pages; 100 megapixels per image after decoding (decompression bombs); PDF object nesting depth 64; text extracted per page 1 MB. Over a limit: the file is marked failed with a clear reason, and nothing crashes.
- **SEC-05 Never compiled or executed.** `.tex` is never compiled. Scripts in PDFs, macros in Office files and embedded files are ignored. Fuzz every reader nightly (`16-ci-cd.md`).

## Unbounded consumption (outbound requests)

- **SEC-10 Rate limiting per provider.** A token bucket for requests per minute and tokens per minute, configurable per provider (`providers.<id>.rateLimit`). Defaults per provider tier from the model catalog. A **Gemini free-tier preset** (requests and tokens per minute, requests per day) is applied when the key is detected as free tier (a 429 whose body names the free tier) or chosen in Settings. Requests wait in the bucket's queue, never fail because of it.
- **SEC-11 Retries.** Honour `retry-after`. Exponential backoff with full jitter, at most 3 retries, and only for idempotent requests (a request is idempotent until its first streamed token has been shown).
- **SEC-12 Spend caps.** Hard caps, all settings: per gloss (output tokens, tool calls, agent steps), per lecture, per day and per month (currency, from catalog prices). Background jobs (digests, figure cards, indexing calls, parked doubts) have their own daily cap. A hedged request counts against the budget; hedging is skipped when it would exceed it. At a cap: background jobs pause, foreground requests ask first (`06-ai-harness.md#usage-cost-and-feedback`). A new install is never unlimited: defaults are $5 per month and $1 per day (`ai.budget.monthly`, `ai.budget.daily`). A model with no catalog price counts against `ai.budget.monthlyTokens` (default 2,000,000 tokens) instead. The cap prompt offers to raise the cap in one step.
- **SEC-13 Runaway and duplicate requests.** Identical in-flight requests (same role, anchor, prompt and model) are coalesced into one, so a repeated `.` or a held key sends one request. User-triggered AI actions are debounced (150 ms). A global concurrency cap (default 4) applies across providers.
- **SEC-14 Timeouts.** Every network call has connect (5 s), first byte (30 s), idle stream (20 s) and total (180 s) timeouts, all settings. No call can hang forever; a timeout is a normal, cancellable error. Response sizes are capped too: one SSE line or JSON event at most 1 MB, one response at most 16 MB (`limits.providerLineBytes`, `limits.providerResponseBytes`); over a cap the stream ends with `E_PROVIDER_TOO_LARGE`. The SSE and JSON stream parsers are fuzz targets.
- **SEC-15 Live tests during the build.** Spike and eval scripts get keys only through `scripts/live.sh`, follow the same rate limits (free-tier preset by default) and save partial results when the daily cap is reached.

## AI input and output

- **SEC-20 Untrusted text is labelled.** Slide, source and web text is wrapped in `<untrusted_source>` and never placed in the system or role prompt.
- **SEC-21 No side effects beyond note actions.** The only write tools are `note_actions`, each visible and undoable. No shell, file-write or network tools. `memory.md` changes only from the user's ratings.
- **SEC-22 Rendered output is sanitised.** No raw HTML in glosses or notes. KaTeX `trust: false`. Mermaid in strict security mode.
- **SEC-23 No auto-loading URLs.** AI output and notes never load remote resources: Markdown images with remote URLs render as a link chip, not an image; CSP `img-src` allows only `'self' lecter: data:`. A prompt-injected answer must not be able to exfiltrate notes through an image URL. A test renders such an answer and asserts no request leaves the webview.
- **SEC-24 Links and web search are visible.** Links in glosses show their target host; only `http(s)` opens, through the opener, after a confirmation. Web search runs only where enabled (`06-ai-harness.md#web-search-configuration`), and every query the model makes is shown in the gloss footer, so private text sent as a query is visible. Anthropic's native `web_fetch` (which can send text to any URL a page names) is off unless the user turns it on (`ai.search.allowFetch`, default false); when on, the allow and block lists apply to every fetched URL.
- **SEC-25 Course settings can't loosen global ones.** These keys are global-only and ignored with a notice in `course.jsonc` and course role files: provider hosts and base URLs, `feedback.endpoint`, search service URLs, `privacy.*`, `log.*`, `limits.*`, and any budget higher than the global one. A course role can't enable a tool or web search that the global settings turn off. The trust screen lists the course's `AGENTS.md`, role files, skills and settings overrides, and trust is asked again when any of them changes.
- **SEC-26 Exports embed nothing local.** Pandoc runs with `--sandbox`, and AI-written text is read as Markdown without `raw_tex` and `raw_html`, so an `\input{}`, `\include{}` or local image path in a gloss can't pull a file into an export.

## Tauri and IPC

- **SEC-30 CSP.** Main webview: `default-src 'self'; img-src 'self' lecter: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src ipc: http://ipc.localhost; object-src 'none'; frame-src lecter-fig:`. No remote content, no `eval`, no inline scripts.
- **SEC-31 Least-privilege capabilities.** One capability file per window, listing only the commands that window uses. No remote URLs in any capability. The figure frame gets none.
- **SEC-32 Every command validates its input in Rust** (`18-contracts.md#validation`): types, string lengths, list sizes, payload size (1 MB per call by default; larger data goes through `lecter://` or channels), path canonicalisation. The UI is never trusted.
- **SEC-33 `lecter://` serves only the content-hash cache.** The handler accepts `lecter://cache/<blake3>.<ext>` and nothing else: no paths, no `..`, no other folders. The same rule holds for `lecter-fig:` (hash-named figure files only) and `lecter-lib:` (bundled, version-pinned libraries only); anything else gets a 404.
- **SEC-34 Devtools are off in release builds.** The WebDriver plugin (`tauri-plugin-wdio-webdriver`) and the test hooks exist only in debug builds; CI checks release binaries for their symbols (`16-ci-cd.md`).
- **SEC-35 Dropped and opened paths are validated:** canonicalised, must be a regular file or folder the user chose, symlinks resolved and re-checked against the course root.
- **SEC-36 Isolation pattern.** Decide in the walking skeleton whether to enable Tauri's isolation pattern (it adds an IPC hop per call; measure it against the keystroke budget) and record a D-entry.

## Secrets

- **SEC-40 Keychain only.** Keys and tokens live in the OS keychain under service `lecter`, never in files, SQLite, logs, crash reports or test fixtures.
- **SEC-41 Secret types.** A `Secret` newtype redacts itself in `Debug` and `Display` and is zeroised on drop. It never crosses IPC to the UI, except as a mask (`sk-…7f3a`).
- **SEC-42 No silent plaintext fallback.** Linux without a Secret Service provider shows a clear error with fix steps (install or unlock GNOME Keyring or KWallet). Lecter never falls back to storing keys in a file.
- **SEC-43 Requests only to configured hosts** over TLS (rustls, system roots). Keys go only to their own provider's host: a redirect to another host drops the key, a bad certificate fails with no override, and plain `http` is allowed only for `localhost` and `127.0.0.1`.
- **SEC-44 Browser sign-in.** OAuth sign-in uses PKCE (S256) and a random `state` checked on return. The redirect listener binds `127.0.0.1` on a random port, accepts one callback and closes after 5 minutes. Tokens go straight to the keychain (SEC-40).

## Supply chain

- **SEC-50 Locked and checked dependencies.** Lockfiles committed. `cargo-deny` (licences, bans, sources, advisories), `pnpm audit` in CI. Licence policy: `01-architecture.md#dependency-policy`.
- **SEC-51 Checksum-pinned downloads.** PDFium binaries, local models and any other download are pinned by SHA-256 in the repository and verified before use.
- **SEC-52 Licence notices ship in the app.** About → Licences lists every Rust crate and npm package with its licence text, generated at build time (`cargo-about` or equivalent, plus the npm licences).
- **SEC-53 Signed releases and updates.** SBOM per release; signed builds where credentials exist; the updater verifies signatures.
- **SEC-54 No invented packages.** Agents add dependencies only through `scripts/add_dep.py`, which stops for the maintainer when a package is under 90 days old or has few downloads (under 10,000 in total for a crate, under 1,000 a week for an npm package): AI agents sometimes name packages that don't exist, and attackers register those names.

## Privacy

- **SEC-60 No telemetry.** Nothing leaves the machine except requests to the user's own providers, web search when enabled, and the update check, which Settings → Privacy lists and can turn off.
- **SEC-61 Feedback sharing is opt-in**, with a second opt-in for text and a visible sample payload (`06-ai-harness.md#usage-cost-and-feedback`).
- **SEC-62 Logs hold no content.** No prompt, answer, note or key text in logs by default (`log.content = false`). Log rotation and redaction: `17-robustness.md#logs-and-crash-reports`.

## Folder access

- **SEC-27 Trust is enforced in the core.** AI, indexing and scripted-figure commands on a read-only course return `E_NOT_TRUSTED` from the Rust core, whatever the UI shows.

AI tools read only inside trusted courses, minus `.lecterignore`. Every `read` canonicalises the path and requires it to stay under the course root. The floating terminal (v1) is the user's own shell; the AI can never write to it.
