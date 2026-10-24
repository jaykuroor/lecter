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

- pnpm and verify need Node 24 (D-061): init.sh and verify.sh put a `node` link to `/usr/bin/node-24` first on `PATH`; for bare pnpm commands do it yourself.
- pnpm 12 reads settings from `pnpm_config_*` env vars, not `npm_config_*` (e.g. `pnpm_config_store_dir`) (F-013).
- In the sandbox, add_dep.py fails with a read-only "store operation lock" unless `XDG_RUNTIME_DIR` points at a writable dir (e.g. `$TMPDIR/xdg-run`).
- `installMockCore` is serialised by `page.addInitScript`: keep it self-contained (no imported values at runtime).
- Vitest runs without globals, so component tests call `afterEach(cleanup)` themselves.
- Biome's `noInvalidGridAreas` misfires on valid multi-row `grid-template-areas`; place grid items by line numbers instead.
