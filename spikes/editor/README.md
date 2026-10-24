# Spike F-001 · CodeMirror lecture surface performance

**Question.** Can one CodeMirror 6 buffer with `@replit/codemirror-vim`, KaTeX (MathML output,
`trust: false`) and gloss widgets hold a 200-slide lecture inside `keystroke_p99_ms` (p99 < 8 ms,
`docs/spec/14-quality.md#performance-budgets`) in both Chromium and WebKit? (D-005, D-006.)

## Prototype

| File | What |
|---|---|
| `src/fixture.ts` | Deterministic synthetic 200-slide lecture in the `03-lecture-files.md` format: slide divs, bracketed blocks with inline math, one display formula per slide, a `.gloss` on every 2nd slide, a `.note` on every 5th. English text only. |
| `src/blocks.ts` | `StateField` of block decorations: slide header widgets, gloss cards with a meta-bar widget, notes, display math. After an edit only the changed lines are rescanned (the whole slide if a `:::` fence line was touched). |
| `src/math.ts` | KaTeX in its own chunk, loaded after the first paint. Inline `$…$` becomes widgets in the visible ranges (raw text while the cursor is inside). On an edit or cursor move only the changed lines and the old/new cursor lines are rescanned. Rendered HTML is cached by source. |
| `src/probe.ts` | The keystroke-to-paint probe (same code in every engine). |
| `src/main.ts` | One `EditorView`: `vim()`, history, line wrapping, the two decoration sources, and lang-markdown loaded after the first paint (`?md=0` leaves it out). The page is ready once KaTeX and markdown are in. |
| `measure.mjs` | Builds nothing itself; serves `dist/`, drives each engine with Playwright, prints the numbers and the verdict. `--query md=0 --tag nomd` measures a page variant into `data/<engine>-nomd.json`. |
| `profile.mjs` | Chromium CPU profile of the same typing (unminified build in `dist-profile/`); not a measurement. |

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
`sudo npx playwright install-deps webkit`, then the three commands above. The runs so far used the
`mcr.microsoft.com/playwright:v1.64.1-noble` image with only `spikes/editor` mounted, running
`npx vite build && node measure.mjs --engines webkit` inside it (optimisation round: also
`node measure.mjs --engines webkit --query md=0 --tag nomd`). Tee the output on the host.

## Results (2026-10-24, Fedora 44 x86-64, headless, Playwright 1.64.1)

Fixture: 200 slides, 3,970 lines, 149,654 chars. JS bundle (CM6 + Vim + KaTeX + markdown) 289 KB gz.

| Engine | first paint | keystroke p50 / p95 / p99 / max | JS heap load → scrolled → typed | process-tree RSS load → typed |
|---|---|---|---|---|
| chromium-novsync (raw, budget number) | 77 ms | 2.9 / 4.5 / **5.2** / 6.1 ms | 5.0 → 7.2 → 8.5 MB | 450 → 530 MB |
| chromium (vsync, work, upper bound) | 83 ms | 4.9 / 7.5 / 19 / 26 ms | 5.0 → 7.4 → 8.5 MB | 447 → 536 MB |
| chromium (vsync, raw) | 83 ms | 15.2 / 17.5 / 22.7 / 27.3 ms | n/a | n/a |
| webkit 27.2 (work, upper bound; playwright:v1.64.1-noble container, run by Jay) | 156 ms | 5 / 9 / **11** / 15 ms | n/a | 530 → 568 (scrolled) → 736 MB |
| webkit 27.2 (raw) | 156 ms | 15 / 21 / 25 / 34 ms | n/a | n/a |

- **Chromium: GO.** End-to-end p99 is 5.2 ms against 8 ms, with headroom. The JS heap stays under 9 MB after every widget has rendered once.
- **WebKit: NO-GO by the script** (work p99 11 ms > 8). That run came before the handler/frame split, so it can't show how much of the tail is frame wait. WebKit coarsens `performance.now()` to 1 ms (every WebKit number is an integer), and work sums about 6 intervals, so each sample also carries a few ms of quantization. Re-run with the split (below) before deciding. The real app's WebKitGTK is measured by the `keystroke_p99_ms` WebDriver trace from M0.5.
- RSS here is headless Chromium's whole process tree (browser, GPU, network, renderer), so it isn't comparable with `idle_rss_mb`, which is the Tauri app with WebKitGTK.
- The bundle was 289 KB gz in one chunk, over `ui_main_chunk_kb_gz` (≤ 250 KB). The optimisation round below splits KaTeX and markdown out (main chunk 140 KB gz).

### Split and sync pass (added after the first WebKit run)

`measure.mjs` now also reports `handler` and `frame` (the two parts of work), the mean split of the
slowest 5 % / 1 % of keystrokes, the timer resolution, and a second typing pass on a fresh page
(`?sync=1`). That pass flushes CodeMirror's measure and forces style + layout at each event's end
mark, so its `handler` ("sync") is input handling through layout with no rAF (no paint or composite).
The earlier numbers are computed exactly as before. Chromium (`.evidence/F-001/measurement-chromium-split.log`):

| Engine | handler p50 / p99 | frame p50 / p99 | slowest 1 %: work = handler + frame | sync p50 / p99 / max |
|---|---|---|---|---|
| chromium (vsync) | 2.1 / 6.3 | 3.2 / 15.5 | 20.7 = 3.5 + 17.2 | 3.3 / 6.8 / 7.7 ms |
| chromium-novsync | 0.8 / 1.9 | 1.4 / 2.4 | 4.5 = 2.0 + 2.5 | 1.1 / 2.3 / 3.4 ms |
| webkit 27.2 (run 2, Jay's container; 1 ms timer) | 2 / 6 | 2 / 7 | 16 = 8.2 + 7.8 | 4 / 9 / 12 ms |

WebKit run 2 (`.evidence/F-001/measurement-webkit-split.log`): work 5/9/12/25, raw 15/21/27/29 ms, first paint 153 ms, RSS 526 → 569 → 749 MB. Script verdict **NO-GO** (p99 12). Unlike Chromium, the WebKit tail is about half handler and half frame, not one late frame, and sync p99 is 9 ms (≥ 8). So WebKit's tail is real editor/engine work, not only the artifact.

## Optimisation round (after WebKit run 2)

Changes: KaTeX and lang-markdown moved to lazy chunks loaded after the first paint (main chunk 289 → 140 KB gz; KaTeX 78 KB gz and markdown 83 KB gz chunks). Block decorations rescan only the changed lines, not the slide. Inline math updates only the changed and cursor lines on edits and cursor moves, not every visible range. The measurement method is unchanged; `measure.mjs` only gained `--query` / `--tag`.

**Profile** (`profile.mjs`, Chromium, 300 keys; `.evidence/F-001/profile-before.txt`, `profile-after.txt`; times inflated by the profiler):

- The spike's own decoration code was already small: about 0.16 ms/key inclusive before, about 0.07 after (scan 0.03 → 0.001 ms/key).
- Per keystroke, the time goes to CodeMirror core. Reading the DOM change and the view update are about 1.7 ms/key inclusive. The height map (`updateHeight` 0.28 ms/key self), layout reads (`getBoundingClientRect` / `getClientRects`) and the measure cycle are the largest self costs.
- **The one other clear cost found is lang-markdown's incremental Lezer parse inside the state update: about 0.85 ms/key inclusive.** The spike doesn't use the syntax tree (no highlighting), so `?md=0` measures the editor without it. Whether the real app needs it is a product question.

Chromium before/after (`measurement-chromium-split.log` → `measurement-chromium-opt.log`, `measurement-chromium-opt-nomd.log`), single runs:

| Chromium run | first paint | work p50/p95/p99/max | raw p50/p95/p99/max | handler p50/p99 | frame p50/p99 | slowest 1 % (h + f) | sync p50/p95/p99/max |
|---|---|---|---|---|---|---|---|
| vsync, before | 78 | 5.4 / 8.1 / 18.9 / 21.4 | 14.9 / 18.6 / 24.2 / 25.7 | 2.1 / 6.3 | 3.2 / 15.5 | 20.7 = 3.5 + 17.2 | 3.3 / 5.9 / 6.8 / 7.7 |
| vsync, after | 62 | 5.4 / 8.1 / 20.3 / 26.4 | 14.9 / 18.2 / 24.4 / 27.1 | 1.9 / 5.9 | 3.2 / 16.5 | 22.0 = 4.8 + 17.2 | 3.5 / 5.8 / 7.3 / 11.0 |
| vsync, after, md=0 | 46 | 4.5 / 6.9 / 8.4 / 25.6 | 15.1 / 18.4 / 19.3 / 26.3 | 1.3 / 5.1 | 3.1 / 5.4 | 14.5 = 5.9 + 8.6 | 2.4 / 4.0 / 6.3 / 8.3 |
| novsync, before | 86 | 2.2 / 3.0 / 4.0 / 4.9 | 2.9 / 4.0 / **5.1** / 5.9 | 0.8 / 1.9 | 1.4 / 2.4 | 4.5 = 2.0 + 2.5 | 1.1 / 1.7 / 2.3 / 3.4 |
| novsync, after | 47 | 2.1 / 3.0 / 3.6 / 4.5 | 2.7 / 4.0 / **4.8** / 5.7 | 0.8 / 1.8 | 1.3 / 2.3 | 4.1 = 1.3 + 2.7 | 1.1 / 1.8 / 2.4 / 4.5 |
| novsync, after, md=0 | 58 | 1.9 / 3.1 / 4.1 / 5.2 | 2.4 / 4.2 / **5.7** / 6.8 | 0.5 / 1.7 | 1.3 / 3.0 | 4.6 = 1.1 + 3.5 | 0.8 / 1.4 / 1.9 / 2.4 |

- Keystroke cost in Chromium barely moved (within run-to-run noise), as the profile predicted: the decoration code wasn't the cost. Leaving out markdown lowers handler and sync p50 by about 0.3 ms (novsync) and 1.1 ms (vsync sync p50). The p99 differences are within noise of single runs.
- First paint improved (lazy chunks), and the main chunk is now within `ui_main_chunk_kb_gz`.
- WebKit after the optimisation: pending Jay's container run 3 (`measurement-webkit-opt.log`).

- In vsync Chromium, the slowest 1 % is almost all frame time (17.2 ms ≈ one 16.7 ms frame): the after-paint task landed a frame late. That's the artifact, not editor work.
- Handler and sync times are also about 3× higher with vsync on than off (sync p99 6.8 vs 2.3 ms), on the same code. The likely cause is the CPU clocking down while idle between frames; that isn't proven. Real use behaves the same way, so the vsync-on sync number is the cautious one.
