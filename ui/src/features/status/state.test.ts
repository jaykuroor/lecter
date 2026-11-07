import { createComputed, createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { createStatus, type StatusState } from "./state";

// 09-ui.md#layout: what the status line shows, from the buffer (mode, slide), the command lines and
// the answers streaming (jobs, model).

let status: StatusState;
let dispose: () => void = () => {};
const make = () =>
  createRoot((d) => {
    dispose = d;
    status = createStatus(window);
    return status;
  });

afterEach(() => {
  status?.stop();
  dispose();
  document.body.replaceChildren();
});

/** Focuses a fresh input, inside a Vim prompt panel when `vimPanel`. */
function focusField(vimPanel: boolean): HTMLInputElement {
  const box = document.createElement("div");
  if (vimPanel) box.className = "cm-vim-panel";
  const input = document.createElement("input");
  box.append(input);
  document.body.append(box);
  input.focus();
  return input;
}

describe("createStatus", () => {
  it("starts in normal mode with no slide, model or job", () => {
    make();
    expect(status.mode()).toBe("normal");
    expect(status.slide()).toBeNull();
    expect(status.model()).toBeNull();
    expect(status.running()).toBe(0);
  });

  it("follows the buffer's Vim mode", () => {
    make();
    status.buffer.mode("insert");
    expect(status.mode()).toBe("insert");
    status.buffer.mode("visual");
    expect(status.mode()).toBe("visual");
    status.buffer.mode("normal");
    expect(status.mode()).toBe("normal");
  });

  it("is COMMAND while Lecter's command line is open", () => {
    make();
    const [open, setOpen] = createSignal(false);
    status.followCommandLine(open);
    expect(status.mode()).toBe("normal");
    setOpen(true);
    expect(status.mode()).toBe("command");
    setOpen(false);
    expect(status.mode()).toBe("normal");
  });

  it("is COMMAND while the focus is in Vim's own prompt (`/`, `:` over a selection)", () => {
    make();
    status.buffer.mode("visual");
    focusField(true);
    expect(status.mode()).toBe("command");
    // Back to the buffer (any other field): Vim's mode again.
    focusField(false);
    expect(status.mode()).toBe("visual");
  });

  it("leaves COMMAND when the focus leaves Vim's prompt for nothing", () => {
    make();
    const input = focusField(true);
    expect(status.mode()).toBe("command");
    input.blur();
    expect(status.mode()).toBe("normal");
  });

  it("stops following the focus once stopped", () => {
    make();
    // Focus leaves a field for Vim's prompt: a focusout (towards the prompt), then a focusin.
    focusField(false);
    status.stop();
    focusField(true);
    expect(status.mode()).toBe("normal");
  });

  it("changes nothing on screen for a slide equal to the one shown, `null` included", () => {
    make();
    let changes = 0;
    createRoot((d) => {
      createComputed(() => {
        status.slide();
        changes++;
      });
      return d;
    });
    status.buffer.slide(null);
    status.buffer.slide({ n: 1, total: 2 });
    status.buffer.slide({ n: 1, total: 2 });
    // The first run, then one change.
    expect(changes).toBe(2);
  });

  it("keeps the slide the buffer reports, without a change for an equal one", () => {
    make();
    status.buffer.slide({ n: 2, total: 5 });
    const first = status.slide();
    expect(first).toEqual({ n: 2, total: 5 });
    status.buffer.slide({ n: 2, total: 5 });
    // The same object is kept: no update reaches the DOM.
    expect(status.slide()).toBe(first);
    status.buffer.slide({ n: 2, total: 6 });
    expect(status.slide()).toEqual({ n: 2, total: 6 });
    status.buffer.slide({ n: 3, total: 6 });
    expect(status.slide()).toEqual({ n: 3, total: 6 });
    status.buffer.slide(null);
    expect(status.slide()).toBeNull();
  });

  it("counts running jobs, each ending once however often its end is called", () => {
    make();
    const one = status.buffer.jobs.begin();
    const two = status.buffer.jobs.begin();
    expect(status.running()).toBe(2);
    one();
    one();
    expect(status.running()).toBe(1);
    two();
    expect(status.running()).toBe(0);
  });

  it("keeps the model the last stream named", () => {
    make();
    status.buffer.jobs.model("sample");
    expect(status.model()).toBe("sample");
    status.buffer.jobs.model("claude-haiku");
    expect(status.model()).toBe("claude-haiku");
  });
});
