// The gloss card's DOM (docs/design/components.md#gloss, #prompt-row): what it shows in each state
// and what its keys and buttons do. The answer is text, never HTML (13-security.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlossCard } from "./card";

let frames: (() => void)[] = [];
const frame = () => {
  const run = frames;
  frames = [];
  for (const cb of run) cb();
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
});
afterEach(() => vi.unstubAllGlobals());

function make() {
  const sent: string[] = [];
  let escapes = 0;
  const card = new GlossCard("s3b2", { send: (q) => sent.push(q), escape: () => (escapes += 1) });
  document.body.append(card.root);
  return { card, sent, escapes: () => escapes };
}

const q = (card: GlossCard, sel: string) => card.root.querySelector<HTMLElement>(sel);
const texts = (card: GlossCard, sel: string) => Array.from(card.root.querySelectorAll(sel), (e) => e.textContent);

function key(target: HTMLElement, k: string, shiftKey = false): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe("the prompt row", () => {
  it("shows the ask label, a labelled one-line input and the ↵ Send keycap", () => {
    const { card } = make();
    expect(card.root.className).toBe("gloss");
    expect(card.root.dataset).toMatchObject({ anchor: "s3b2", state: "prompt" });
    expect(card.state).toBe("prompt");
    expect(card.root.children).toHaveLength(1);
    expect(q(card, ".gloss-ask.gloss-prompt")).not.toBeNull();
    expect(texts(card, ".gloss-ask-label")).toEqual(["ask · new gloss"]);
    const input = q(card, "textarea.gloss-prompt-input") as HTMLTextAreaElement;
    expect([input.rows, input.getAttribute("aria-label"), input.placeholder]).toEqual([
      1,
      "Ask about this line",
      "Ask about this line…",
    ]);
    const send = q(card, "button.gloss-action.gloss-send") as HTMLButtonElement;
    expect([send.type, send.getAttribute("aria-label")]).toEqual(["button", "Send"]);
    expect(texts(card, ".gloss-send kbd.gloss-key")).toEqual(["↵"]);
    expect(texts(card, ".gloss-send span.gloss-action-word")).toEqual(["Send"]);
    expect(q(card, ".gloss-body")).toBeNull();
    card.focus();
    expect(document.activeElement).toBe(input);
  });

  it("sends on Enter or a click on ↵, adds a line on Shift-Enter, closes on Esc; keys stay in the card", () => {
    const { card, sent, escapes } = make();
    const outside = vi.fn();
    document.body.addEventListener("keydown", outside);
    const input = q(card, ".gloss-prompt-input") as HTMLTextAreaElement;
    input.value = "why?";
    expect(key(input, "Enter").defaultPrevented).toBe(true);
    expect(key(input, "Enter", true).defaultPrevented).toBe(false);
    expect(key(input, "x").defaultPrevented).toBe(false);
    (q(card, ".gloss-send") as HTMLButtonElement).click();
    expect(sent).toEqual(["why?", "why?"]);
    expect(key(input, "Escape").defaultPrevented).toBe(true);
    expect(escapes()).toBe(1);
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", outside);
  });

  it("a keycap's mousedown keeps the focus where it is", () => {
    const { card } = make();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    q(card, ".gloss-send")?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});

describe("the streaming card", () => {
  it("shows the question, the model, the Esc Stop keycap and the growing answer with a caret", () => {
    const { card, escapes } = make();
    card.streaming("  why the 2Cov term?\n");
    expect(card.root.dataset.state).toBe("streaming");
    expect(texts(card, ".gloss-ask-label")).toEqual(["you asked"]);
    expect(texts(card, ".gloss-question")).toEqual(["why the 2Cov term?"]);
    expect(q(card, ".gloss-prompt-input")).toBeNull();
    card.model("sample");
    expect(texts(card, ".gloss-ask .gloss-meta")).toEqual(["sample"]);
    const stop = q(card, ".gloss-ask button.gloss-action.gloss-stop") as HTMLButtonElement;
    expect(stop.getAttribute("aria-label")).toBe("Stop");
    expect(texts(card, ".gloss-stop kbd")).toEqual(["Esc"]);
    stop.click();
    expect(escapes()).toBe(1);
    const body = q(card, ".gloss-body") as HTMLElement;
    expect(body.getAttribute("aria-live")).toBe("polite");
    expect(body.querySelector(".gloss-caret")?.textContent).toBe("");
    card.append("<b>not</b> ");
    card.append("bold");
    expect(body.textContent).toBe("");
    frame();
    expect(body.textContent).toBe("<b>not</b> bold");
    expect(body.querySelector("b")).toBeNull();
  });

  it("stop drops what hasn't been drawn, removes the Stop keycap and takes no more text", () => {
    const { card } = make();
    card.streaming("q");
    card.append("shown ");
    frame();
    card.append("dropped");
    card.stop();
    expect(card.root.dataset.state).toBe("stopped");
    expect(q(card, ".gloss-stop")).toBeNull();
    frame();
    card.append("late");
    frame();
    expect(q(card, ".gloss-body")?.textContent).toBe("shown ");
  });

  it("stop does nothing to a prompt", () => {
    const { card } = make();
    card.stop();
    expect(card.state).toBe("prompt");
    card.append("x");
    expect(frames).toHaveLength(0);
  });

  it("fail replaces the answer with the message as an alert", () => {
    const { card } = make();
    card.streaming("q");
    card.append("part");
    frame();
    card.fail("The AI provider failed.");
    expect(card.root.dataset.state).toBe("failed");
    expect(q(card, ".gloss-stop")).toBeNull();
    const body = q(card, ".gloss-body") as HTMLElement;
    expect(body.textContent).toBe("The AI provider failed.");
    expect(body.querySelector("p.gloss-error")?.getAttribute("role")).toBe("alert");
  });
});
