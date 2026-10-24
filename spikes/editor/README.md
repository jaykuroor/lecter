# Spike F-001 · CodeMirror lecture surface performance

**Question.** Can one CodeMirror 6 buffer with `@replit/codemirror-vim`, KaTeX (MathML output,
`trust: false`) and gloss widgets hold a 200-slide lecture inside `keystroke_p99_ms` (p99 < 8 ms,
`docs/spec/14-quality.md#performance-budgets`) in both Chromium and WebKit? (D-005, D-006.)

## Prototype

| File | What |
|---|---|
| `src/fixture.ts` | Deterministic synthetic 200-slide lecture in the `03-lecture-files.md` format: slide divs, bracketed blocks with inline math, one display formula per slide, a `.gloss` on every 2nd slide, a `.note` on every 5th. English text only. |
| `src/blocks.ts` | `StateField` of block decorations: slide header widgets, gloss cards with a meta-bar widget, notes, display math. After an edit only the touched slides are rescanned. |
| `src/math.ts` | KaTeX: inline `$…$` replaced by widgets in the visible ranges only (raw text while the cursor is inside), rendered HTML cached by source. |
| `src/probe.ts` | The keystroke-to-paint probe (same code in every engine). |
| `src/main.ts` | One `EditorView`: `vim()`, history, markdown, line wrapping, the two decoration sources. |
| `measure.mjs` | Builds nothing itself; serves `dist/`, drives each engine with Playwright, prints the numbers and the verdict. |

## Method

- Load `?slides=200`, wait for the first paint. Memory after load, after scrolling end to end (every
  widget rendered once), and after typing.
- Put the cursor on slide 100, Vim `o`, then 50 warm-up + 500 measured keystrokes: text with inline
  math, and every 60 characters `Esc k j w b A` (normal-mode motions back into insert). Each key is
  sent with `page.keyboard.press` and the next waits until the previous one has painted.
- **raw**: first event's `timeStamp` → the task after the last frame's paint. With vsync on it
  includes the idle wait for the next frame (≥ 1 frame interval at 60 Hz), so it can't be compared
  with an 8 ms budget. `chromium-novsync` (`--disable-gpu-vsync --disable-frame-rate-limit`)
  produces frames as soon as they're needed, so its raw is a true end-to-end keystroke-to-paint.
  **That's the budget number for Chromium.**
- **work**: Σ per key/input event (its capture listener on window → after the last listener on the
  target and its microtasks) + Σ per frame (rAF start → task after paint). Main-thread time without
  the vsync wait. With vsync on, the after-paint task sometimes lands a frame late, so work is an
  **upper bound** with a tail (chromium work p99 19 ms vs chromium-novsync raw p99 5.2 ms on the
  same code). It's the WebKit budget number, because WebKit can't switch vsync off.
- A first probe that ended each event with a posted task measured 60–130 ms "work": Chromium runs
  the next frame before such a task. Don't use task posting to find the end of input handling.
- **Memory**: RSS of the whole browser process tree (`ps`), both engines; JS heap after a forced GC
  (CDP `Runtime.getHeapUsage`) in Chromium only, because WebKit exposes no heap API to Playwright.
- Headless, 1280×800. Playwright 1.64.1 browsers (Chromium 1248; WebKit from `playwright install webkit`).

## Rerun

`pnpm.sh` is `pnpm` with the environment `scripts/init.sh` sets up (sandbox proxy, store lock, home
store); outside the Claude sandbox plain `pnpm -C spikes/editor …` works too.

```
spikes/editor/pnpm.sh install                         # its own lockfile; not part of ui/ (D-079)
spikes/editor/pnpm.sh exec playwright install webkit  # once; Chromium is shared with ui/
spikes/editor/pnpm.sh run measure 2>&1 | tee .evidence/F-001/measurement.log
```

One engine: `spikes/editor/pnpm.sh run build && node spikes/editor/measure.mjs --engines webkit`
(engines: `chromium`, `chromium-novsync`, `webkit`). Exit 0 = GO, 1 = NO-GO, 2 = an engine could
not be measured. Raw JSON lands in `data/` (git-ignored).

**WebKit on Fedora.** Playwright doesn't support Fedora and installs its Ubuntu 24.04 WebKit build,
which needs `libicu*.so.74`, `libjpeg.so.8`, `libjxl.so.0.8` and `libbacktrace.so.0`. Fedora 44 ships
other sonames, so it won't launch. Run the WebKit part on Ubuntu 24.04 (a CI runner or a container):
`sudo npx playwright install-deps webkit`, then the three commands above.

## Results (2026-10-24, Fedora 44 x86-64, headless, Playwright 1.64.1)

Fixture: 200 slides, 3,970 lines, 149,654 chars. JS bundle (CM6 + Vim + KaTeX + markdown) 289 KB gz.

| Engine | first paint | keystroke p50 / p95 / p99 / max | JS heap load → scrolled → typed | process-tree RSS load → typed |
|---|---|---|---|---|
| chromium-novsync (raw, budget number) | 77 ms | 2.9 / 4.5 / **5.2** / 6.1 ms | 5.0 → 7.2 → 8.5 MB | 450 → 530 MB |
| chromium (vsync, work, upper bound) | 83 ms | 4.9 / 7.5 / 19 / 26 ms | 5.0 → 7.4 → 8.5 MB | 447 → 536 MB |
| chromium (vsync, raw) | 83 ms | 15.2 / 17.5 / 22.7 / 27.3 ms | n/a | n/a |
| webkit | not measured: host libraries missing (above) | | | |

- **Chromium: GO.** End-to-end p99 is 5.2 ms against 8 ms, with headroom. The JS heap stays under 9 MB after every widget has rendered once.
- **WebKit: open.** Measure it on Ubuntu 24.04 before relying on it. The real app's WebKitGTK is also measured by the `keystroke_p99_ms` WebDriver trace from M0.5.
- RSS here is headless Chromium's whole process tree (browser, GPU, network, renderer), so it isn't comparable with `idle_rss_mb`, which is the Tauri app with WebKitGTK.
- The bundle is 289 KB gz, over `ui_main_chunk_kb_gz` (≤ 250 KB). KaTeX (75 KB gz minified) and lang-markdown are the candidates to lazy-load out of the main chunk when the real surface is built.
