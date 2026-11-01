# Spike F-027 · Vim and IME composition in three webviews

**Question.** In the real app's webview on each OS (WebKitGTK on Linux, WKWebView on macOS,
WebView2 on Windows), does an IME composition in the lecture buffer land its text exactly once,
and do Vim's normal-mode keys stay quiet while a composition is in progress
(`10-keymap.md#move-everywhere`, `09-ui.md#editing`)? Which failures show up per webview, and
what workaround do we take?

## Method

The flow `tests/e2e/flows/ime.ts` runs in CI's `e2e-app` job (the debug app with the embedded
WebDriver server, `--features test-hooks`). WebDriver drives Vim (`i`, `Esc`, `j`, `gg`, `u`). The
page plays the composition the way the UI Events spec orders it, because WebDriver can't drive a
real IME:

1. keydown `Process` (keyCode 229) → `compositionstart`;
2. per candidate (`か`, `かな`, `仮名`): `compositionupdate` → `beforeinput`
   (`insertCompositionText`) → the DOM text change at the caret → `input`;
3. keydown `Enter` (229, isComposing) → `compositionend` (`仮名`) → keyup.

While the composition is open, keys arrive in-page as keydown/keyup with keyCode 229 and
`isComposing` (named by the typed key, as WebKit can, and `Process`, as Chromium does), and as
plain WebDriver keys.

| Case | Checks (asserted) | Observations (logged only) |
|---|---|---|
| insert | the first candidate reaches CodeMirror's state; mid-composition `Esc`, `j`, `Process` (229) and WebDriver `Esc`, `j` change neither mode, cursor nor text; the commit is in the state once, on screen once (`仮名Covariance…`) and in the saved `.md` once; `Esc` and `j` work again afterwards | |
| normal | mid-composition `j`, `G`, `x`, `Process` (229) and WebDriver `j`, `x` change neither mode, cursor nor text; still normal mode after the commit; `u` restores the text | whether a two-character commit (`きゃ`) lands in the buffer in normal mode; whether a keyCode-229 `j` *before* `compositionstart` moves the cursor |

Every check prints `IME <webview> <case> <check>: ok|FAIL (<detail>)`; the test then asserts that
none failed, so one run reports every failure of every webview.

What CodeMirror 6.43 / @replit/codemirror-vim 6.4 do (read from their source, to compare with the
run): CodeMirror ignores key events only once a composition has changed the document
(`inputState.composing > 0`); EditContext is used only on Android, so all three desktop webviews
take the DOM/MutationObserver path. codemirror-vim skips keydowns named `Process`, `Unidentified`
or `Dead`, but doesn't look at `keyCode` 229 or `isComposing`; in normal mode it reads a
one-character composition as a Vim key and ends the composition, and lets longer text through.

## Rerun

- All three webviews (CI): push the branch, then
  `gh workflow run ci.yml --ref <branch>` (workflow_dispatch adds macos-15 and windows-2025 to
  the `e2e-app` matrix). When the run has finished: `spikes/ime/fetch.sh <run-id>` saves the
  `e2e-app` logs as `.evidence/F-027/e2e-app.log` and prints the tally (`summary.txt`).
- One webview (this machine, outside the Claude sandbox): `scripts/e2e-app.sh ime --evidence
  F-027`, then `python3 spikes/ime/summary.py .evidence/F-027/e2e-app.log`.

## Results

Pending: the CI run on all three webviews hasn't happened yet. The tally from `fetch.sh` and the
D-entry (failures per webview, chosen workaround) go here.
