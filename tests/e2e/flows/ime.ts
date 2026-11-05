// F-027 spike: Vim and IME composition in the real app's webview (WebKitGTK, WKWebView, WebView2;
// 10-keymap.md#move-everywhere, 09-ui.md#editing). WebDriver drives Vim's normal and insert modes
// (i, Esc, j, gg), and the page plays an IME composition as the UI Events spec orders it: a
// keydown with keyCode 229, compositionstart, then per candidate compositionupdate, beforeinput
// (insertCompositionText), the DOM text change and input, and at the end compositionend and the
// keyup. Keys pressed during the composition arrive as keyCode 229 with isComposing (in-page, in
// both shapes engines use: the typed key, and "Process") and as plain WebDriver keys.
//
// Checked: the composed text lands once (editor state, block text and the saved file) and no
// normal-mode key fires while composing (mode, cursor and text unchanged). Each check is logged as
// `IME <webview> <case> <check>: ok|FAIL (<detail>)` before the test asserts them all, so one CI
// run gives every webview's failures (also in the GitHub job summary; spikes/ime/summary.py
// tallies them). Logged as observations, not asserted: whether composed text lands in normal mode
// (slide lines' read-only rule is F-020's), whether Vim's u removes it, and whether a keyCode-229
// key before compositionstart runs as a Vim key. The buffer is put back through the editor itself.
//
// The page reads CodeMirror's state through the content element's view (`cmTile.root.view`, what
// EditorView.findFromDOM uses): flows can't import packages (tests/CLAUDE.md).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shot } from "../support/shot.ts";

const NAME = "2026-10-27-l12-ime.md";
const STEM = "2026-10-27-l12-ime";
const FIRST = "Covariance measures how two variables move together.";
const SECOND = "It is zero for independent variables.";
// A synthetic lecture as Lecter writes it (03-lecture-files.md). English only; the IME input is
// Japanese because composing it is the point.
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 12",
  "date: 2026-10-27",
  "title: Covariance",
  "---",
  "",
  '::: {.slide #s1 n=1 src="A1" title="Covariance"}',
  "## Covariance",
  "",
  `[${FIRST}]{#s1b1}`,
  "",
  `[${SECOND}]{#s1b2}`,
  "",
  ":::",
  "",
].join("\n");
/** Candidates an IME shows while "kana" is typed and converted, then the committed text. */
const CANDIDATES = ["か", "かな", "仮名"];
const COMMIT = "仮名";
/** Two characters in one update: codemirror-vim treats single characters as normal-mode keys. */
const NORMAL_TEXT = "きゃ";

function course(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

const file = () => join(course(), "lectures", NAME);

/** What the page reports: CodeMirror's text and cursor, the Vim mode and the cursor's block. */
type Probe = { doc: string | null; head: number | null; mode: string; focused: string; block: string };

/** The in-page IME player installed by `install()`. */
type Ime = {
  start(): void;
  update(text: string): string;
  end(text: string): void;
  key(key: string, composing: boolean): void;
  probe(): Probe;
  /** Turns the editor's text back into `doc` with one change (the differing middle part). */
  restore(doc: string): boolean;
};
type ImeWindow = Window & { __lecterIme?: Ime };

/** Installs the IME player in the page (one per flow run; `after` removes it). */
function install(): Promise<string> {
  return browser.execute(() => {
    type Cm = {
      state: { doc: { toString(): string }; selection: { main: { head: number } } };
      dispatch(spec: { changes: { from: number; to: number; insert: string } }): void;
    };
    type Tiled = Element & { cmTile?: { root?: { view?: Cm } } };
    const content = (): HTMLElement => {
      const c = document.querySelector<HTMLElement>(".cm-content");
      if (!c) throw new Error("no editor");
      return c;
    };
    const view = (): Cm | null => (content() as Tiled).cmTile?.root?.view ?? null;
    let len = 0;
    const key = (type: "keydown" | "keyup", k: string, composing: boolean) => {
      const code = k.length === 1 ? `Key${k.toUpperCase()}` : k === "Process" ? "" : k;
      const e = new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true, isComposing: composing });
      Object.defineProperty(e, "keyCode", { get: () => 229 });
      Object.defineProperty(e, "which", { get: () => 229 });
      content().dispatchEvent(e);
    };
    const composition = (type: string, data: string) =>
      content().dispatchEvent(new CompositionEvent(type, { data, bubbles: true, cancelable: true }));
    const input = (type: string, data: string) =>
      content().dispatchEvent(
        new InputEvent(type, { inputType: "insertCompositionText", data, isComposing: true, bubbles: true }),
      );
    const ime: Ime = {
      start() {
        len = 0;
        key("keydown", "Process", false);
        composition("compositionstart", "");
      },
      // Replaces the composition so far (the `len` characters before the caret) with `text`.
      update(text) {
        const sel = window.getSelection();
        let node = sel?.focusNode ?? null;
        let at = sel?.focusOffset ?? 0;
        if (!sel || !node) return "no selection";
        if (node.nodeType !== Node.TEXT_NODE) {
          if (len > 0) return "the composition's text node is gone";
          const after = node.childNodes[at] ?? null;
          const before = node.childNodes[at - 1] ?? null;
          if (after?.nodeType === Node.TEXT_NODE) [node, at] = [after, 0];
          else if (before?.nodeType === Node.TEXT_NODE) [node, at] = [before, (before as Text).length];
          else {
            const t = document.createTextNode("");
            node.insertBefore(t, after);
            [node, at] = [t, 0];
          }
        }
        const from = at - len;
        if (from < 0) return "the caret is not after the composition";
        composition("compositionupdate", text);
        input("beforeinput", text);
        (node as Text).replaceData(from, len, text);
        len = text.length;
        sel.collapse(node, from + len);
        input("input", text);
        return "ok";
      },
      end(text) {
        key("keydown", "Enter", true);
        composition("compositionend", text);
        key("keyup", "Enter", false);
        len = 0;
      },
      key(k, composing) {
        key("keydown", k, composing);
        key("keyup", k, composing);
      },
      probe() {
        const v = view();
        return {
          doc: v ? v.state.doc.toString() : null,
          head: v ? v.state.selection.main.head : null,
          mode: document.querySelector<HTMLElement>(".lecture-buffer")?.dataset.vimMode ?? "",
          focused: document.querySelector(".cm-focused-line")?.textContent ?? "",
          block: document.querySelector(".cm-block")?.textContent ?? "",
        };
      },
      restore(doc) {
        const v = view();
        if (!v) return false;
        const now = v.state.doc.toString();
        let from = 0;
        while (from < now.length && from < doc.length && now[from] === doc[from]) from += 1;
        let tail = 0;
        while (tail < now.length - from && tail < doc.length - from && now.at(-1 - tail) === doc.at(-1 - tail))
          tail += 1;
        v.dispatch({ changes: { from, to: now.length - tail, insert: doc.slice(from, doc.length - tail) } });
        return true;
      },
    };
    (window as ImeWindow).__lecterIme = ime;
    return `${navigator.userAgent}`;
  });
}

const probe = () => browser.execute(() => (window as ImeWindow).__lecterIme?.probe() ?? null);
/** When the flow last did something that may edit the lecture (the core saves 1 s later). */
let lastEdit = 0;
const edited = () => {
  lastEdit = Date.now();
};
/** The core's save debounce (01-architecture.md#document-model), with a margin. */
const SAVE_QUIET_MS = 1500;

const start = () => browser.execute(() => (window as ImeWindow).__lecterIme?.start());
const update = (t: string) => {
  edited();
  return browser.execute((s: string) => (window as ImeWindow).__lecterIme?.update(s) ?? "no IME player", t);
};
const end = (t: string) => {
  edited();
  return browser.execute((s: string) => (window as ImeWindow).__lecterIme?.end(s), t);
};
/** A keydown and keyup with keyCode 229 and isComposing, as a webview sends them mid-composition. */
const composingKey = (k: string) => {
  edited();
  return browser.execute((s: string) => (window as ImeWindow).__lecterIme?.key(s, true), k);
};
/** A keydown and keyup with keyCode 229 but not isComposing: the key that opens a composition. */
const firstKey = (k: string) => {
  edited();
  return browser.execute((s: string) => (window as ImeWindow).__lecterIme?.key(s, false), k);
};
/** Sets the editor's text back to `doc` through the editor (not through Vim). */
async function restore(doc: string): Promise<void> {
  edited();
  const ok = await browser.execute((d: string) => (window as ImeWindow).__lecterIme?.restore(d) ?? false, doc);
  if (!ok) throw new Error("can't reach the editor to restore its text");
}
/** A WebDriver key press (Vim may edit on it). */
async function press(k: string): Promise<void> {
  edited();
  await browser.keys(k);
  edited();
}

/** Which of the three webviews this is, from its user agent. */
function webview(ua: string): string {
  if (/Edg\//.test(ua)) return "WebView2";
  if (/Macintosh/.test(ua)) return "WKWebView";
  if (/Linux/.test(ua) && /AppleWebKit/.test(ua)) return "WebKitGTK";
  return `unknown(${ua})`;
}

let summaryStarted = false;
/**
 * Prints `line` to the run's output and, on GitHub Actions, adds it to the job summary: verify.sh
 * keeps e2e-app's output in .verify/ and CI uploads that only when the job fails, so the summary
 * is where a passing webview's lines show (spikes/ime/README.md).
 */
function report(line: string): void {
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  const head = summaryStarted ? "" : "\n#### F-027 IME checks\n\n";
  summaryStarted = true;
  // Indented four spaces: one Markdown code block, so the lines read exactly as in the log.
  appendFileSync(summary, `${head}    ${line}\n`);
}

/** Records named checks, logs each one and asserts that none failed. */
class Checks {
  private failed: string[] = [];
  constructor(
    private readonly engine: string,
    private readonly scenario: string,
  ) {}
  check(name: string, ok: boolean, detail: unknown): void {
    const shown = JSON.stringify(detail);
    report(`IME ${this.engine} ${this.scenario} ${name}: ${ok ? "ok" : "FAIL"} (${shown})`);
    if (!ok) this.failed.push(`${name}: ${shown}`);
  }
  note(name: string, detail: unknown): void {
    report(`IME ${this.engine} ${this.scenario} ${name}: observed (${JSON.stringify(detail)})`);
  }
  assertAll(): void {
    expect(this.failed).toEqual([]);
  }
}

/** Waits until `ready` holds for the page's probe (or the deadline passes) and returns the probe. */
async function settle(ready: (p: Probe) => boolean, what: string): Promise<Probe> {
  const seen: { last: Probe | null } = { last: null };
  await browser
    .waitUntil(
      async () => {
        seen.last = await probe();
        return seen.last !== null && ready(seen.last);
      },
      { timeout: 5000, interval: 50, timeoutMsg: what },
    )
    .catch(() => undefined);
  if (seen.last === null) throw new Error("the IME player is not installed");
  return seen.last;
}

const inserted = (doc: string, at: number, text: string) => doc.slice(0, at) + text + doc.slice(at);
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

let engine = "unknown";

describe("Vim and IME composition", function () {
  // The service's window-focus check can add ~10 s of waits before finds and clicks.
  this.timeout(300_000);

  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(file(), LECTURE);
  });

  // Other flows list this course's lectures exactly; the page keeps no IME player.
  // A save still pending once the file is gone would write it back, so first wait until the core
  // has saved what the buffer holds and no edit is younger than the save debounce.
  after(async () => {
    await browser.keys("Escape").catch(() => undefined);
    await browser
      .waitUntil(
        async () => {
          const doc = (await probe())?.doc;
          return Date.now() - lastEdit > SAVE_QUIET_MS && doc != null && readFileSync(file(), "utf8") === doc;
        },
        { timeout: 15_000, interval: 100 },
      )
      .catch(() => console.log("IME the lecture's last save was not seen; removing the file anyway"));
    await browser.execute(() => delete (window as ImeWindow).__lecterIme).catch(() => undefined);
    rmSync(file(), { force: true });
    const journal = join(course(), ".lecter", "journal");
    if (existsSync(journal)) {
      for (const f of readdirSync(journal).filter((f) => f.startsWith(STEM))) rmSync(join(journal, f), { force: true });
    }
  });

  it("lands an insert-mode composition once, with no Vim key firing while composing", async () => {
    await $("button.rail-add").click();
    await $(`button.course-file-open[data-path="lectures/${NAME}"]`).click();
    await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
    await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
    const ua = await install();
    engine = webview(ua);
    const checks = new Checks(engine, "insert");
    report(`IME ${engine} user-agent: ${ua}`);

    await press("i");
    await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "insert");
    const before = await settle((p) => p.doc !== null, "no editor state");
    checks.check("state readable", before.doc !== null && before.head !== null, { head: before.head });
    const doc0 = before.doc ?? "";
    const at = before.head ?? 0;

    await start();
    const first = CANDIDATES[0] ?? "";
    checks.check("first candidate typed", (await update(first)) === "ok", first);
    const typed = await settle((p) => p.doc === inserted(doc0, at, first), "first candidate");
    checks.check("first candidate in the state", typed.doc === inserted(doc0, at, first), typed.block);

    // Mid-composition keys: Esc must not leave insert mode, j must not move, Process is inert.
    for (const k of ["Escape", "j", "Process"]) {
      await composingKey(k);
      const p = await probe();
      checks.check(`keyCode-229 ${k} ignored`, p?.mode === "insert" && p.head === typed.head && p.doc === typed.doc, {
        mode: p?.mode,
        head: p?.head,
      });
    }
    for (const k of ["Escape", "j"]) {
      await press(k);
      const p = await probe();
      checks.check(`webdriver ${k} ignored`, p?.mode === "insert" && p.head === typed.head && p.doc === typed.doc, {
        mode: p?.mode,
        head: p?.head,
      });
    }

    for (const c of CANDIDATES.slice(1)) checks.check(`candidate ${c} typed`, (await update(c)) === "ok", c);
    await end(COMMIT);
    const want = inserted(doc0, at, COMMIT);
    const done = await settle((p) => p.doc === want && p.block === `${COMMIT}${FIRST}`, "the committed text");
    checks.check("committed once in the state", done.doc === want && count(done.doc ?? "", COMMIT) === 1, {
      occurrences: count(done.doc ?? "", COMMIT),
    });
    checks.check("committed once on screen", done.block === `${COMMIT}${FIRST}`, done.block);
    checks.check("still insert mode", done.mode === "insert", done.mode);
    await shot("ime-committed");

    // The core saves the .md 1 s after the last edit: the text is in the file once, as typed.
    let saved = "";
    await browser
      .waitUntil(
        async () => {
          saved = readFileSync(file(), "utf8");
          return saved === want;
        },
        { timeout: 15_000, interval: 100 },
      )
      .catch(() => undefined);
    checks.check("saved once", saved === want && count(saved, `[${COMMIT}${FIRST}]{#s1b1}`) === 1, {
      occurrences: count(saved, COMMIT),
    });

    // After the composition Vim is back: Esc to normal mode, j moves to the next block.
    await press("Escape");
    const normal = await settle((p) => p.mode === "normal", "normal mode after Esc");
    checks.check("Esc after the composition", normal.mode === "normal", normal.mode);
    await press("j");
    const moved = await settle((p) => p.focused === SECOND, "j after the composition");
    checks.check("j after the composition", moved.focused === SECOND, moved.focused);
    checks.assertAll();
  });

  it("fires no normal-mode key during a composition in normal mode", async () => {
    const checks = new Checks(engine, "normal");
    await press("g");
    await press("g");
    const before = await settle((p) => p.mode === "normal" && p.focused.endsWith(FIRST), "gg to the first block");
    checks.check("gg to the first block", before.focused.endsWith(FIRST) && before.mode === "normal", before.focused);
    const doc0 = before.doc ?? "";

    // The key that opens a composition comes before compositionstart, with keyCode 229 but not
    // isComposing. Chromium names it "Process"; if a webview names it by the typed key (as WebKit
    // can), Vim reads it as that key. Observed, then undone with gg.
    await firstKey("j");
    const opened = (await probe()) ?? before;
    checks.note("keyCode-229 j before compositionstart moves", { moves: opened.head !== before.head });
    await press("g");
    await press("g");
    await settle((p) => p.head === before.head, "gg back to the first block");

    await start();
    checks.check("text typed", (await update(NORMAL_TEXT)) === "ok", NORMAL_TEXT);
    // One character would be read by codemirror-vim as a key; two are inserted, which starts
    // CodeMirror's composition tracking.
    const typed = await settle((p) => p.doc !== doc0, "the composed text");
    // Mid-composition keys: j and G must not move, x must not delete.
    for (const k of ["j", "G", "x", "Process"]) {
      await composingKey(k);
      const p = await probe();
      checks.check(`keyCode-229 ${k} ignored`, p?.mode === "normal" && p.head === typed.head && p.doc === typed.doc, {
        mode: p?.mode,
        head: p?.head,
      });
    }
    for (const k of ["j", "x"]) {
      await press(k);
      const p = await probe();
      checks.check(`webdriver ${k} ignored`, p?.mode === "normal" && p.head === typed.head && p.doc === typed.doc, {
        mode: p?.mode,
        head: p?.head,
      });
    }
    await end(NORMAL_TEXT);
    const after = (await probe()) ?? typed;
    checks.check("still normal mode", after.mode === "normal", after.mode);
    checks.note("composed text in normal mode lands in the buffer", {
      lands: (after.doc ?? "") !== doc0,
      occurrences: count(after.doc ?? "", NORMAL_TEXT),
    });
    await shot("ime-normal");

    // Vim's u on the composed text, observed; then the text goes back to how it was through the
    // editor itself (one change, saved like typing), so the next steps don't depend on u.
    if ((after.doc ?? "") !== doc0) {
      await press("u");
      const undone = await settle((p) => p.doc === doc0, "u");
      checks.note("u undoes the normal-mode composed text", {
        undone: undone.doc === doc0,
        [NORMAL_TEXT]: count(undone.doc ?? "", NORMAL_TEXT),
        [COMMIT]: count(undone.doc ?? "", COMMIT),
        mode: undone.mode,
      });
      if (undone.doc !== doc0) await restore(doc0);
      await press("Escape");
    }
    const restored = await settle((p) => p.doc === doc0 && p.mode === "normal", "the text before the test");
    checks.assertAll();
    // Later flows find the buffer in normal mode with the text it had before this test.
    expect(restored).toMatchObject({ doc: doc0, mode: "normal" });
  });
});
