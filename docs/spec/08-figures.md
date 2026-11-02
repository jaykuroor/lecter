# 08 · Interactive figures

The agent may add a chart, diagram, plot with sliders or small interactive demo to any gloss when it judges it helps. Lecter displays whatever it produces.

## Tiers

| Tier | Formats | Use |
|---|---|---|
| Described (cheap) | Vega-Lite, function plot spec (expressions, domain, sliders), Mermaid, SVG, KaTeX | Most figures; few tokens; renders instantly; exports cleanly |
| Page (expensive) | Self-contained HTML + JS using only bundled libraries (D3, Plotly, three.js, JSXGraph) | Simulations, 3D, custom widgets |

Function plot spec (rendered by Lecter):

```json
{ "type": "fnplot", "exprs": ["x^2"], "x": [-1, 1], "params": { "n": { "min": 10, "max": 1000, "value": 100 } },
  "scatter": { "sample": "x ~ U(-1,1); y = x^2", "n": "n" } }
```

## Auto and Ask

Setting `figures.mode`: `auto`, `ask`, `off`, settable globally, per course, per role and per prompt. Defaults: `auto` for described figures, `ask` for pages.

1. The model calls `propose_figure` (about 40 tokens): `{ tier, kind, purpose, est_tokens }`. It may propose a cheap and an expensive option together.
2. **Ask**: Lecter shows a card in the gloss while the text keeps streaming, for example "Interactive plot of Y = X² with a slider for n · described · ~300 tokens · +4 s" and "Full simulation · page · ~2,500 tokens · +30 s". Keys when the card is focused: `y` (first option), `2` (second), `n` (skip), `A` (always allow this kind); each also has a keycap button.
3. **Auto**: builds the cheaper option immediately, then shows the same card so the user can upgrade or remove it.
4. Estimate = `est_tokens / model output tokens per second` (rolling average, `07-providers.md`) + render time (described: 0.2 s; page: 1 s). Before any history, use the catalog speed or 60 tokens/s.
5. The figure is generated in a separate request after the text answer, with the text answer and the proposal as context. A figure never delays the first words.

## Sandbox (pages)

- Rendered in an `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), with CSP `default-src 'none'; script-src lecter-fig: lecter-lib:; style-src 'unsafe-inline'; img-src data:`. No network, no parent access, no storage, no keys. Schemes are named, not `'self'`: WebKit never matches `'self'` in an opaque-origin frame (D-142).
- Native request filter: the CSP alone doesn't hold (WebView2 sends `<link rel=prefetch>` despite `default-src 'none'`), so the app refuses every request from a figure frame that isn't to `lecter-fig:` or `lecter-lib:`, below the page: WebView2 `WebResourceRequested`; WebKitGTK and WKWebView a content rule list or checks in the scheme handlers.
- IPC: the frame gets no capability, and the core drops every IPC message that doesn't come from the main frame (SEC-31).
- Libraries come from a bundled `lecter-lib://` scheme, version-pinned. `lecter-lib:` and `lecter-fig:` serve only bundled or hash-named files and return 404 for anything else (SEC-33).
- Watchdog: core-side. The core evaluates a heartbeat in the webview (`webview.eval`) every 250 ms; a frame with no answer for 1.5 s (busy main thread), or over 150 MB, is killed from the native side and replaced by its static image. An in-page watchdog alone can't work: WebKitGTK and WKWebView run the frame on the parent's thread.
- In a read-only (untrusted) course, only static images show.

## Storage and export

- Source saved to `lectures/assets/<lecture>/<figure-id>.<ext>`; a static SVG or PNG render saved beside it at creation.
- The gloss references both; Markdown viewers and Pandoc export use the static image.

## Memory

At most 3 live page frames at once (setting). Frames scrolled out of view are replaced by their static image and restored when they come back into view. Described figures re-render from their spec when visible.
