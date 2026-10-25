# Spike F-017 · Cost of Tauri's isolation pattern per IPC call (SEC-36)

**Question.** Tauri's isolation pattern routes every IPC call from the main frame through a
sandboxed iframe, which encrypts the payload with AES-GCM before it goes to the core, which decrypts
it. What does that add per call, measured against the keystroke budget (`keystroke_p99_ms`, p99 < 8 ms,
`docs/spec/14-quality.md#performance-budgets`)? Should Lecter turn it on?

## Method

`measure.mjs` serves two pages from a local server and drives them with ui/'s Playwright:

- **The isolation frame** repeats the per-call work of Tauri's `isolation.js` (tauri-utils 2.10.2,
  `src/pattern/isolation.js`): the payload's JSON body, `crypto.subtle.encrypt` (AES-GCM, 12-byte
  random IV), `Array.from` of the IV and the ciphertext into number arrays, `postMessage` to the
  parent. It is a `sandbox="allow-scripts"` iframe (an opaque origin), as in Tauri.
- **The main frame**, per call: without isolation, the JSON body only; with isolation,
  `postMessage` to the frame, wait for the sealed message, JSON body of that (what Tauri's `ipc.js`
  then sends). The transport (`ipc://` custom protocol) is the same in both cases and isn't measured,
  except that the sealed body is ~3.6× larger.
- **The core side** of an isolated call: parse the sealed JSON and AES-256-GCM decrypt
  (tauri-utils `isolation.rs`). Node's `JSON.parse` and OpenSSL stand in for serde_json and
  RustCrypto's `aes-gcm` (both use AES-NI), so this column is an estimate.
- The payload is a `lecture_apply_edits`-shaped call whose insert is 1 B (a keystroke), 256 B, 16 KB
  (the prompt limit) and 64 KB (the string limit). 50 warm-up calls, then 2,000 per size. Browsers
  coarsen `performance.now()` to 0.1 ms, so the means are measured over the whole batch; p99 is per
  call at that resolution.

Rerun: `pnpm -C ui install`, then `node spikes/isolation/measure.mjs [--engines chromium,webkit] [--calls 2000]`.

## Results

Fedora 44, Intel i7-14700KF, Node 24.18.0, Playwright's Chromium 156.0.8078.4 (ms per call):

| Insert | JSON body | Sealed body | Plain mean / p99 | Isolated mean / p99 | Core mean / p99 | **Added mean / p99** |
|---|---|---|---|---|---|---|
| 1 B | 64 B | 379 B | 0.000 / 0.0 | 0.020 / 0.1 | 0.010 / 0.017 | **0.03 / 0.12** |
| 256 B | 319 B | 1.3 KB | 0.000 / 0.0 | 0.029 / 0.1 | 0.013 / 0.022 | **0.04 / 0.12** |
| 16 KB | 16 KB | 58.9 KB | 0.002 / 0.1 | 4.46 / 6.1 | 0.19 / 0.27 | **4.6 / 6.3** |
| 64 KB | 64 KB | 235 KB | 0.007 / 0.1 | 16.1 / 20.6 | 0.83 / 2.0 | **16.9 / 22.5** |

- The cost grows with the payload, and it's almost all main-thread JavaScript: `Array.from` over the
  ciphertext and structured-cloning, then JSON-encoding, a number array about 3.6× the size of the
  body. Iframes share the main frame's thread in the webview, so this time blocks typing.
- A keystroke-sized call costs ~0.1 ms at p99, so it fits the 8 ms budget. A 16 KB prompt costs
  6.3 ms at p99, which is most of a frame. A 64 KB call costs 22.5 ms, which drops frames while
  you type.

## Not covered

- **WebKitGTK and WKWebView.** Playwright's WebKit build won't launch on Fedora 44 (spikes/CLAUDE.md).
  `--engines webkit` runs it on Ubuntu. The real-app number (WebKitGTK with
  `app.security.pattern = isolation`) needs a display, which the build sandbox doesn't have.
- The core-side column is a Node/OpenSSL estimate of serde_json + `aes-gcm`, not the Rust code.

## Recommendation

**Leave the isolation pattern off in v0** (Tauri's default "brownfield" pattern). It would
add 5–23 ms of main-thread work to the 16–64 KB calls that v0 makes (prompts, pasted text, edits
in large lectures), and the threat it guards against is already covered. Isolation protects the
core from a compromised front-end dependency that forges or tampers with IPC calls. Lecter
already limits that damage in four ways:

- the SEC-30 CSP: no remote scripts and no `eval`;
- one least-privilege capability per window (SEC-31);
- every command validated in Rust (SEC-32);
- a figure frame that gets no IPC.

Revisit if the main webview ever runs third-party or remote code, or if a WebKitGTK measurement
shows a cost below 1 ms per call at 64 KB.
