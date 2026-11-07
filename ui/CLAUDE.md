# ui/ (SolidJS + TypeScript + CodeMirror 6)

Spec: `09-ui.md`, `10-keymap.md`, `11-dashboard.md`, `12-settings-theme-onboarding.md`, `03-lecture-files.md#body`.
Design: `docs/design/` (`tokens.json`, `components.md`, `reference/` crops). Build each component to its entry there; compare your screenshot with its crop.

## Invariants

- Keystroke to paint: p99 < 8 ms on the 200-slide fixture.
  - Every keystroke is handled locally.
  - Never await the core on the key path.
  - Stream updates are batched to one paint per animation frame.
- The lecture is one CodeMirror buffer. Slides, glosses, figures and keycaps are widgets and decorations. Don't nest editors per block.
- Vim through `@replit/codemirror-vim`, with the bindings from `10-keymap.md` exactly. Every action must also be reachable by mouse (Slack/Discord-style hover and context menus), and the hint bar and keycaps show its key.
- Keycap buttons (3D, Discord-like) appear when a gloss is selected. The prompt row's Tab toggles {into this gloss, new gloss}; Enter sends.
- Colours, spacing, radii, type and shadows: CSS custom properties generated from `docs/design/tokens.json` only. On Linux the GTK theme overrides the mapped tokens (`12-settings-theme-onboarding.md#theme`); the bundled "Lecter" theme is the fallback.
- Math: KaTeX with MathML output and `trust: false`. Markdown in glosses is sanitised (no raw HTML).
- State lives in Solid stores under `src/state/`. Components don't call `invoke` directly; they use the generated bindings in `src/core/bindings.ts` (never hand-edited; `18-contracts.md#ipc`) through `src/core/` wrappers. The mocked core implements the same generated types.
- Bundle: main chunk ≤ 250 KB gz. Lazy-load the dashboard, settings, onboarding and figure runtime.
- Accessibility: every control is focusable and labelled, with visible focus and reduced-motion support.

## Tests

- `pnpm -C ui exec vitest run`
- Playwright runs against the mocked core: `pnpm -C ui run test:e2e`. Smoke set: `test:e2e:smoke`.
- The real app: `drive-app` skill (`scripts/e2e-app.sh`).

## Learned

- pnpm and verify need the pinned Node from fnm (D-130): init.sh and verify.sh put a `node` link to fnm's install of `engines.node` first on `PATH`; for bare pnpm commands outside a login shell, `. scripts/node_env.sh` first.
- pnpm 12 reads settings from `pnpm_config_*` env vars, not `npm_config_*` (e.g. `pnpm_config_store_dir`) (F-013).
- In the sandbox, add_dep.py fails with a read-only "store operation lock" unless `XDG_RUNTIME_DIR` points at a writable dir (e.g. `$TMPDIR/xdg-run`).
- `installMockCore` is serialised by `page.addInitScript`: keep it self-contained (no imported values at runtime).
- Vitest runs without globals, so component tests call `afterEach(cleanup)` themselves.
- Biome's `noInvalidGridAreas` misfires on valid multi-row `grid-template-areas`; place grid items by line numbers instead.
- `ui/knip.json` and `ui/.jscpd.json` are protected: the guard freezes them after their first write unless the card lists them under `protected` (F-014).
- Solid compiles a JSX prop expression into a getter: `<X state={createY()} />` calls `createY()` on every read of `props.state`; create stores before the JSX (F-018)
- `add_dep.py ui` rewrites `pnpm-lock.yaml` in pnpm's own style; the committed one is Biome-formatted, so run `pnpm -C ui exec biome format --write pnpm-lock.yaml` after it or biome ci fails (F-016)
- @replit/codemirror-vim's key table is global: `Vim.mapCommand` changes every Vim editor on the page, so lecture motions check the `lectureBuffer` facet and fall back to plain lines (F-020)
- Vitest (jsdom) can drive Vim: `Vim.handleKey(getCM(view), key, "user")`; CM layout doesn't exist there, so test positions, not pixels (F-020)
- CodeMirror schedules its own `requestAnimationFrame` measures: a test that stubs rAF to step frames must count paints (e.g. spy on `Text.prototype.appendData`), not queued frames, and give jsdom's `Range` empty `getClientRects` (src/features/gloss/gloss.test.ts) (F-023)
- The keystroke check (`e2e/buffer-perf.spec.ts`) is tagged `@perf`: `test:e2e` skips it; run it alone with `pnpm -C ui run test:perf` (D-120)
- Run outside init.sh's environment, `add_dep.py ui` leaves a ~400 MB `.pnpm-store/` in the checkout that the secret scan then reads for 20+ minutes: set `pnpm_config_store_dir` to the home store first (F-020)
- CodeMirror makes its own IntersectionObservers: a fake `IntersectionObserver` in a test must keep each instance's callback and targets, not one global (src/features/figures/figure.test.ts) (F-024)
- Stryker's `--incremental` keeps old `Survived` results for module-level (static) mutants such as top-level regexes even after their tests change: delete `ui/reports/stryker-incremental.json` and rerun `scripts/mutants.py` (F-024)
- CodeMirror's caret blink is an endless CSS animation; the buffer turns it off and runs a 10 s Web Animation instead (src/features/buffer/caret.ts). jsdom has no `Element.animate`: use the fake timeline in `src/features/buffer/__tests__/timeline.ts` (F-029)
- CodeMirror reports a focus change (`update.focusChanged`) 10 ms after the DOM focus event, in a setTimeout: tests wait it out (F-029)
- CodeMirror block widgets (slide heading, gloss card, figure) must not have vertical margins: its height map counts the border box only, so clicks below them land on later lines. Use padding (src/features/buffer/Buffer.css .slide-heading) (F-029)
- The webview blinks its own (transparent) caret in a focused contenteditable even under CodeMirror: it was the whole idle CPU. Making it non-editable stops it only once the selection is set again (removeAllRanges, then setBaseAndExtent); macOS WebKit re-checks the blink only on a selection change (src/features/buffer/nativeCaret.ts) (F-180)
- Solid's `<For>` moves the existing rows when the same objects are reordered, so a focused row keeps focus in jsdom anyway; a focus-after-reorder test must hand the list new objects, as the core would (src/features/rail/CourseRail.test.tsx) (F-035)
- Playwright's `Desktop Safari` device sends a Mac user agent on Linux: tell macOS by `navigator.platform`, never the user agent, or Ctrl shortcuts wait for Cmd in the WebKit project (src/keys/platform.ts) (F-035)
- Solid's delegated events never run a disabled button's handlers, so a `busy` check inside one can't fail (a surviving mutant); rely on `disabled`. jsdom refuses `focus()` on a disabled button too (F-033)
- A JSX spread (`<button {...attrs}>`) puts Solid's `spread` and its attribute tables (~4.6 KB raw of solid-js/web) in the first-paint chunk, even when the spread sits in a lazy chunk (shared runtime code goes to the entry): write the attributes out (src/features/sidebar/Sidebar.tsx) (F-036)
- `pnpm -C ui run test:e2e -- <name>` runs every spec, both projects (the filter doesn't reach Playwright); for one spec run `pnpm -C ui exec playwright test e2e/<name>.spec.ts --project=chromium` (F-036)
- Under Stryker's instrumentation a `ref` callback passed as a component prop lost its element (the dry run failed); reach a component's DOM through a container you made instead (src/keys/WhichKey.tsx) (F-037)
- The key engine (src/keys/install.ts) is a lazy chunk loaded after the first paint; until then boot.ts holds only ␣, the key after it and Ctrl/Cmd-1…9. A test pressing other keys right after `render(<App />)` waits until Ctrl-9 goes through (src/App.keys.test.tsx) (F-037)
- codemirror-vim leaves named keys it has no entry for (Enter, Tab) to the browser even in normal mode: Enter moves the caret a line, Tab moves focus; the engine takes the given-up ones in the buffer (src/keys/install.ts) (F-037)
- The key engine's `onChange` is one slot, which-key's: another listener wraps it and hands it back on stop only if it still holds it (src/features/overlay/mount.tsx) (F-039)
- `:` in normal mode opens Lecter's command line (src/features/cmdline/mount.tsx remaps it in Vim's global table); lines other than `:set` run on Vim's Ex table as typed, and a new `:` command adds its name to `COMMANDS` in src/features/cmdline/complete.ts to be completed (F-040)
- jsdom tests can't read repo files through `import.meta.url` (not a file: URL) or a `?raw` import outside ui/ (Vite denies the id): walk up from `process.cwd()` (`src/features/cmdline/__tests__/schemaText.ts`) (F-040)
- V8's sort only looks at `compare(a, b) < 0`, so a comparator's `> 0 ? 1 : 0` branch is a surviving mutant: return -1 or 1 for unique keys (F-040)
- A grid with no `grid-template-columns` gets an implicit `auto` column that grows to its items' min-content: a one-line row (hint bar, status notice) then widened the buffer under the side panel in a 1024 px window (macOS CI) and cost ~58 MB on rss_300; give single-column grids `minmax(0, 1fr)` (src/App.css, e2e/document-column.spec.ts) (CI-bdabbe9)
- Anything an App test leaves running outlives jsdom ("document/window is not defined" after the file): stoppers clear their timers and ignore late callbacks (keys/WhichKey.tsx, buffer/prewarm.ts), and a test that can end before the app's lazy chunks load awaits their imports in `afterAll` (Solid's delegation reads `window` as a module loads) (CI-9e68fff)
- keymaps.jsonc arrives after the engine starts; `setUserKeymap` keeps a pending key (a ␣ held back at boot) and reads the next one on the new keymap. It used to reset the engine, which dropped ␣e on WebKit CI (src/keys/install.ts) (F-041)
- In jsdom an input focused through `queueMicrotask` (the cmdline's and palette's fields) has no focus until the test awaits a microtask: without that, focus-restoring code passes untested (src/features/palette/mount.test.tsx `open`) (F-041)
- The mocked core's `settings_source` lists only the fixture's `settings.values`, and Settings shows only settings with a value: give every schema key one (e2e/settings.spec.ts `plain`) or its row is missing (F-045)
