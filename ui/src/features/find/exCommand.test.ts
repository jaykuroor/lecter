import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { afterEach, describe, expect, it } from "vitest";
import { type ExApi, registerFindCommand } from "./exCommand";

/** A recording stand-in for Vim's Ex table. */
function fakeApi(): ExApi & { defined: [string, string | undefined][]; run: (args: string) => void } {
  const defined: [string, string | undefined][] = [];
  let fn: Parameters<ExApi["defineEx"]>[2] | null = null;
  return {
    defined,
    defineEx(name, prefix, f) {
      defined.push([name, prefix]);
      fn = f;
    },
    run(argString) {
      fn?.({} as never, { commandName: "find", argString, input: `find ${argString}`, line: 0, selectionLine: 0 });
    },
  };
}

describe("registerFindCommand", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it("defines :find with the shortest form :fin, once per Vim API", () => {
    const api = fakeApi();
    cleanups.push(registerFindCommand(() => undefined, api));
    cleanups.push(registerFindCommand(() => undefined, api));
    expect(api.defined).toEqual([["find", "fin"]]);
  });

  it("hands the words to the handler set last, and to none once it is unset", () => {
    const api = fakeApi();
    const first: string[] = [];
    const second: string[] = [];
    const unsetFirst = registerFindCommand((w) => first.push(w), api);
    const unsetSecond = registerFindCommand((w) => second.push(w), api);
    api.run("covariance matrix");
    expect([first, second]).toEqual([[], ["covariance matrix"]]);
    // Unsetting a handler that is no longer current changes nothing.
    unsetFirst();
    api.run("again");
    expect(second).toEqual(["covariance matrix", "again"]);
    unsetSecond();
    api.run("dropped");
    expect(second).toEqual(["covariance matrix", "again"]);
  });

  it("runs from Vim's own command line: :find words and :fin words", () => {
    const got: string[] = [];
    cleanups.push(registerFindCommand((w) => got.push(w)));
    const view = new EditorView({
      state: EditorState.create({ doc: "text\n", extensions: [vim()] }),
      parent: document.body,
    });
    // getCM's type allows a CodeMirror without Vim state; the vim() extension gives it one.
    const cm = getCM(view) as Parameters<typeof Vim.handleEx>[0] | null;
    if (!cm) throw new Error("no Vim on the editor");
    Vim.handleEx(cm, "find covariance of sums");
    Vim.handleEx(cm, "fin zero");
    Vim.handleEx(cm, "find");
    expect(got).toEqual(["covariance of sums", "zero", ""]);
    view.destroy();
  });
});
