import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { registerFindCommand } from "../find/exCommand";
import { registerReadCommand } from "../overlay/readEx";
import { settle } from "./__tests__/fakeCore";
import { SCHEMA_TEXT } from "./__tests__/schemaText";
import { ACTION, type ColonApi, mapColon, startCmdline } from "./mount";
import type { ExTarget } from "./state";

type Cm = Parameters<typeof Vim.handleEx>[0];

// CodeMirror measures text ranges to draw the caret; jsdom has no layout, so a range measures as
// nothing (otherwise CodeMirror logs a TypeError for each).
if (!("getClientRects" in Range.prototype)) {
  Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });
}

/** A recording stand-in for Vim's API. */
function fakeApi() {
  const actions: string[] = [];
  const maps: unknown[][] = [];
  const ex: string[] = [];
  let fn: ((cm: unknown) => void) | null = null;
  const api: ColonApi = {
    defineAction(name, f) {
      actions.push(name);
      fn = f as unknown as (cm: unknown) => void;
    },
    mapCommand(...args) {
      maps.push(args);
    },
    handleEx(_cm, line) {
      ex.push(line);
    },
  };
  return { api, actions, maps, ex, press: (cm: unknown) => fn?.(cm) };
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  installMockCore({
    ...defaultFixture,
    settings: { schema: SCHEMA_TEXT, values: { "ui.performance": { value: '"balanced"', source: "default" } } },
  });
});
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  document.body.replaceChildren();
});

function editor(): { view: EditorView; cm: Cm } {
  const view = new EditorView({
    state: EditorState.create({ doc: "one\ntwo\n", extensions: [vim()] }),
    parent: document.body,
  });
  cleanups.push(() => view.destroy());
  const cm = getCM(view) as Cm | null;
  if (!cm) throw new Error("no Vim on the editor");
  return { view, cm };
}

describe("mapColon", () => {
  it("maps `:` in normal mode to the command line once per Vim API", () => {
    const f = fakeApi();
    cleanups.push(mapColon(() => undefined, f.api));
    cleanups.push(mapColon(() => undefined, f.api));
    expect(f.actions).toEqual([ACTION]);
    expect(f.maps).toEqual([[":", "action", ACTION, {}, { context: "normal" }]]);
  });

  it("opens the command line set last for the buffer `:` was pressed in, none once unset", () => {
    const f = fakeApi();
    const first: ExTarget[] = [];
    const second: ExTarget[] = [];
    const unsetFirst = mapColon((w) => first.push(w), f.api);
    const unsetSecond = mapColon((w) => second.push(w), f.api);
    let focused = 0;
    const cm = { focus: () => focused++ };
    f.press(cm);
    expect([first.length, second.length]).toEqual([0, 1]);
    second[0]?.run("find x");
    second[0]?.focus();
    expect(f.ex).toEqual(["find x"]);
    expect(focused).toBe(1);
    unsetFirst();
    f.press(cm);
    expect(second.length).toBe(2);
    unsetSecond();
    f.press(cm);
    expect(second.length).toBe(2);
  });
});

describe("startCmdline", () => {
  it("`:` in a Vim buffer opens the box, focused, instead of Vim's prompt (F-040 criterion 1)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { view, cm } = editor();
    const started = startCmdline({ host, course: () => null });
    cleanups.push(started.stop);
    view.focus();
    Vim.handleKey(cm, ":", "user");
    const box = host.querySelector(".cmdline");
    expect(box?.getAttribute("aria-label")).toBe("Command line");
    await settle();
    const input = host.querySelector("input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
    // Vim's own prompt never opened.
    expect(document.querySelector(".cm-vim-panel")).toBe(null);
    expect(started.cmdline.isOpen()).toBe(true);
  });

  it("runs :find and :read on the buffer's Vim, with their own parsing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { cm } = editor();
    const words: string[] = [];
    let reads = 0;
    cleanups.push(registerFindCommand((w) => words.push(w)));
    cleanups.push(registerReadCommand(() => reads++));
    const started = startCmdline({ host, course: () => null });
    cleanups.push(started.stop);
    for (const line of ["find covariance of sums", "fin zero", "read"]) {
      Vim.handleKey(cm, ":", "user");
      started.cmdline.setText(line);
      started.cmdline.submit();
    }
    expect(words).toEqual(["covariance of sums", "zero"]);
    expect(reads).toBe(1);
    expect(started.cmdline.isOpen()).toBe(false);
  });

  it("leaves visual mode's `:` to Vim", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { cm } = editor();
    const started = startCmdline({ host, course: () => null });
    cleanups.push(started.stop);
    Vim.handleKey(cm, "v", "user");
    Vim.handleKey(cm, ":", "user");
    expect(started.cmdline.isOpen()).toBe(false);
    Vim.handleKey(cm, "<Esc>", "user");
  });

  it("stops: `:` opens nothing and the box is gone", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { cm } = editor();
    const started = startCmdline({ host, course: () => null });
    started.stop();
    Vim.handleKey(cm, ":", "user");
    expect(started.cmdline.isOpen()).toBe(false);
    expect(host.childElementCount).toBe(0);
  });
});
