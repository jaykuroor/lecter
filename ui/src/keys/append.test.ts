// F-048 criterion 3: `a` is Vim's append off a slide line and nothing on one. The action is driven
// here through a recording Vim API, so what it hands Vim is checked key by key (gloss.test.ts
// drives the real Vim in a lecture buffer).
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { lectureState } from "../features/buffer/editorState";
import { type AppendVimApi, registerAppendKey } from "./append";

type Action = Parameters<AppendVimApi["defineAction"]>[1];

/** A recording API: the action it was given, and the keys the action hands Vim. */
function recorder() {
  let action: Action | null = null;
  const handed: string[] = [];
  const api: AppendVimApi = {
    defineAction: (_name, fn) => {
      action = fn;
    },
    mapCommand: () => undefined,
    handleKey: (_cm, key) => void handed.push(key),
  };
  registerAppendKey(api);
  return {
    api,
    handed,
    run: (cm: unknown, repeat?: number) => action?.(cm as never, { repeat } as never, {} as never),
  };
}

const LECTURE = ["[A block.]{#s1b1}", "my own line", ""].join("\n");
let views: EditorView[] = [];
afterEach(() => {
  for (const v of views) v.destroy();
  views = [];
});

function buffer(line: number): { cm: unknown; view: EditorView } {
  const view = new EditorView({ state: lectureState(LECTURE, "Lecture"), parent: document.body });
  views.push(view);
  view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
  return { cm: { cm6: view }, view };
}

describe("the a action", () => {
  it("on an own line hands Vim i alone without a count, and the count's digits before it", () => {
    const r = recorder();
    const { cm, view } = buffer(2);
    r.run(cm, 1);
    expect(r.handed).toEqual(["i"]);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from + 1);
    r.handed.length = 0;
    r.run(cm, 12);
    expect(r.handed).toEqual(["1", "2", "i"]);
    r.handed.length = 0;
    r.run(cm);
    expect(r.handed).toEqual(["i"]);
  });

  it("on a slide line hands Vim nothing and leaves the cursor", () => {
    const r = recorder();
    const { cm, view } = buffer(1);
    const head = view.state.selection.main.head;
    r.run(cm, 3);
    expect(r.handed).toEqual([]);
    expect(view.state.selection.main.head).toBe(head);
  });
});
