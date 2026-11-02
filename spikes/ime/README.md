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
| normal | mid-composition `j`, `G`, `x`, `Process` (229) and WebDriver `j`, `x` change neither mode, cursor nor text; still normal mode after the commit; the text is back as before at the end (through the editor, not Vim) | whether a two-character commit (`きゃ`) lands in the buffer in normal mode; whether Vim's `u` removes it; whether a keyCode-229 `j` *before* `compositionstart` moves the cursor |

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

## Where the lines are

Every check line goes to the wdio output and, on GitHub Actions, to the job summary (run page,
"F-027 IME checks"). verify.sh keeps e2e-app's output in `.verify/`, and `ci.yml` uploads that as
the `e2e-app-<os>` artifact only when the job fails, so a passing job's lines are only in its job
summary, which gh can't download. `fetch.sh` reads artifacts and job logs, plus any job summary
copied into a file or artifacts folder passed as extra arguments. To get every OS's lines without
copying, the e2e-app upload step in `ci.yml` would need `if: always()` instead of
`if: failure()` (not in this card's paths).

## Results

**Run 1:** CI run 41364496453 (head c32a6f3, `workflow_dispatch`). `fetch.sh 41364496453
<artifacts>` gives this tally (`.evidence/F-027/summary.txt`):

| Webview | Checks ok | Failed | Observed |
|---|---|---|---|
| WebKitGTK (ubuntu-24.04, WebKit 605.1.15) | 25/26 | `normal / undone` (`きゃ` still in the text after `u`) | `きゃ` lands in normal mode (1 occurrence); keyCode-229 `j` before `compositionstart` moves the cursor |
| WKWebView (macos-15) | 25/26 | same as WebKitGTK | same as WebKitGTK |
| WebView2 (windows-2025) | job passed, so every asserted check held | none | no lines: the job passed, so no artifact was uploaded |

All criterion-1 checks pass on WebKitGTK and WKWebView: the commit lands once (state, screen,
saved `.md`), and no Vim key fires while a composition is open, in either mode. The only failure
was the `u` check. It shows a known app gap, not criterion 1, so it's an observation from run 2 on.
The buffer is now put back through the editor itself, so the shared app stays clean.

**What the run confirms** (matches the source reading above):

1. Insert mode: CodeMirror's `composing > 0` gate keeps codemirror-vim from seeing any key during
   a composition on both WebKit webviews. Mid-composition `Esc` doesn't leave insert mode.
2. Normal mode: a commit of two or more characters is inserted into the slide line. That breaks
   09-ui.md#editing ("slide lines are read-only in normal mode"). On WebKit, Vim's `u` doesn't
   remove it either.
3. A keyCode-229 key named by its character, sent before `compositionstart`, runs as a Vim key.
   Chromium names that key `Process`, which codemirror-vim skips. Whether WebKit names it by the
   character with a real IME isn't known from synthetic events.

**Workaround (proposed, not built: it needs `ui/src/features/buffer/editorState.ts`):**
- an `EditorView.inputHandler` placed before `vim()` that drops text input while Vim isn't in
  insert or replace mode (the normal-mode read-only rule);
- a capture-phase keydown listener on the editor's outer element that calls `stopPropagation()`
  for `isComposing || keyCode === 229` unless the key is `Process`, `Unidentified` or `Dead`. That
  way Vim never sees an IME key, and codemirror-vim's own IME handling still gets the names it
  knows. It must not `preventDefault()`, which would cancel the IME's input; a CodeMirror handler
  that returns true does exactly that, so a capture listener is used instead.

Run 2 (after these changes) fills in WebView2's observations from its job summary.
