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
- **work** (compared with the budget): Σ per key/input event (end of its task − `event.timeStamp`)
  + Σ per frame it caused (rAF start → task after paint). Main-thread time the keystroke costs,
  without the idle wait for vsync.
- **raw**: first event → after the last paint, vsync wait included (bounded below by the frame
  interval, so it can't be compared with an 8 ms budget on a 60 Hz display; reported for context).
- **Memory**: RSS of the whole browser process tree (`ps`), both engines; JS heap after a forced GC
  (CDP `Runtime.getHeapUsage`) in Chromium only, because WebKit exposes no heap API to Playwright.
- Headless, 1280×800. Playwright 1.64.1 browsers (Chromium 1248; WebKit from `playwright install webkit`).

## Rerun

```
pnpm -C spikes/editor install                       # its own lockfile; not part of ui/
pnpm -C spikes/editor exec playwright install webkit  # once; Chromium is shared with ui/
pnpm -C spikes/editor run measure 2>&1 | tee .evidence/F-001/measurement.log
```

`--engines chromium` (or `webkit`) measures one engine: `pnpm -C spikes/editor run build && node spikes/editor/measure.mjs --engines webkit`.
Exit 0 = GO, 1 = NO-GO, 2 = an engine could not be measured. Raw JSON lands in `data/` (git-ignored).

## Results

Not yet measured: see the F-001 report (installing the spike's packages needs approval).
