import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { fakeCore, settle } from "./__tests__/fakeCore";
import { CommandLine } from "./CommandLine";
import { createCmdline, type ExTarget } from "./state";

afterEach(cleanup);

/** Presses `key` in the focused element, as the browser would. */
function press(key: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
}

/** Types `text` into the command line's input. */
function type(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

/** The command line rendered and opened from a stand-in buffer (a button that takes focus back). */
async function opened(core = fakeCore({ "ui.performance": { value: '"balanced"', source: "default" } })) {
  const cmdline = createCmdline(core);
  const { container } = render(() => <CommandLine cmdline={cmdline} />);
  const buffer = document.createElement("button");
  document.body.append(buffer);
  const ran: string[] = [];
  const target: ExTarget = { run: (line) => ran.push(line), focus: () => buffer.focus() };
  cmdline.open(target);
  await settle();
  const input = container.querySelector("input") as HTMLInputElement;
  return { host: container, input, buffer, ran, core, cmdline };
}

const labels = (host: HTMLElement) =>
  [...host.querySelectorAll(".cmdline-completion-label")].map((el) => el.textContent);

describe("CommandLine", () => {
  it("is a labelled box with the Cmdline notch and a focused combobox (docs/design/components.md#cmdline)", async () => {
    const { host, input } = await opened();
    const box = host.querySelector(".cmdline");
    expect(box?.getAttribute("role")).toBe("dialog");
    expect(box?.getAttribute("aria-label")).toBe("Command line");
    expect(host.querySelector(".cmdline-notch")?.textContent).toBe("Cmdline");
    expect(host.querySelector(".cmdline-prompt")?.textContent).toBe(":");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe("cmdline-completions");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(document.activeElement).toBe(input);
    // Options are reached through the line (aria-activedescendant), not by Tab.
    expect((host.querySelector('[role="option"]') as HTMLElement).tabIndex).toBe(-1);
  });

  it("lists completions as options; Tab and ↑/↓ pick, a click takes one (F-040 criterion 1)", async () => {
    const { host, input } = await opened();
    expect(labels(host)).toEqual(["find", "read", "set"]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    type(input, "set ui.");
    expect(labels(host)).toEqual(["ui.hintBar", "ui.keystrokes", "ui.performance", "ui.theme"]);
    type(input, "set ui.p");
    expect(labels(host)).toEqual(["ui.performance"]);
    expect(host.querySelector(".cmdline-completion-detail")?.textContent).toBe("The speed-or-looks preset.");
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(input.value).toBe("set ui.performance");
    expect(labels(host)).toEqual([]);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    type(input, "set ui.performance=");
    expect(labels(host)).toEqual(["performance", "balanced", "quality"]);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    press("ArrowDown");
    press("ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe("cmdline-option-1");
    expect(host.querySelector("#cmdline-option-1")?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector("#cmdline-option-0")?.getAttribute("aria-selected")).toBe("false");
    press("ArrowUp");
    expect(input.getAttribute("aria-activedescendant")).toBe("cmdline-option-0");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    host.querySelector("#cmdline-option-2")?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(input.value).toBe("set ui.performance=quality");
    expect(document.activeElement).toBe(input);
    // Other keys type as usual.
    expect(press("a").defaultPrevented).toBe(false);
  });

  it("Enter runs :set key? and shows the answer as a status (F-040 criterion 3)", async () => {
    const { host, input, buffer } = await opened();
    type(input, "set ui.performance?");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(host.querySelector(".cmdline")).toBe(null);
    expect(document.activeElement).toBe(buffer);
    await settle();
    const status = host.querySelector('[role="status"]');
    expect(status?.className).toBe("cmdline-message");
    expect(status?.querySelector(".cmdline-message-line")?.textContent).toBe("ui.performance=balanced (default)");
    expect(status?.querySelector(".cmdline-message-note")).toBe(null);
    expect(status?.classList.contains("cmdline-message-error")).toBe(false);
  });

  it("Enter on a refused value keeps the box with the reason as an alert (F-040 criterion 2)", async () => {
    const { host, input, core } = await opened();
    type(input, "set ui.performance=fast");
    press("Enter");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "ui.performance must be one of performance, balanced, quality",
    );
    expect(document.activeElement).toBe(input);
    expect(core.calls).toEqual(["schema"]);
  });

  it("Enter writes and shows the note; the core's refusal shows as an error (F-040 criterion 4)", async () => {
    const { host, input, cmdline, buffer, core } = await opened();
    type(input, "set ui.performance=quality");
    press("Enter");
    await settle();
    expect(host.querySelector(".cmdline-message-line")?.textContent).toBe("ui.performance=quality (global)");
    expect(host.querySelector(".cmdline-message-note")?.textContent).toBe("Can add input lag on slower machines.");
    core.failSet = { code: "E_INVALID_ARGUMENT", message: "ai.hedgeAfterMs refused", retryable: false };
    cmdline.open({ run: () => undefined, focus: () => buffer.focus() });
    await settle();
    type(host.querySelector("input") as HTMLInputElement, "set ai.hedgeAfterMs=5");
    press("Enter");
    await settle();
    expect(host.querySelector(".cmdline-message-error .cmdline-message-line")?.textContent).toBe(
      "ai.hedgeAfterMs refused",
    );
  });

  it("Enter hands other lines to Vim", async () => {
    const { input, ran } = await opened();
    type(input, "find covariance");
    press("Enter");
    expect(ran).toEqual(["find covariance"]);
  });

  it("Escape, or Backspace on an empty line, closes and gives the keys back", async () => {
    const { host, input, buffer, cmdline } = await opened();
    type(input, "se");
    expect(press("Backspace").defaultPrevented).toBe(false);
    expect(host.querySelector(".cmdline")).not.toBe(null);
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(host.querySelector(".cmdline")).toBe(null);
    expect(document.activeElement).toBe(buffer);
    cmdline.open({ run: () => undefined, focus: () => buffer.focus() });
    await settle();
    // On an empty line other keys type.
    expect(press("x").defaultPrevented).toBe(false);
    expect(host.querySelector(".cmdline")).not.toBe(null);
    expect(press("Backspace").defaultPrevented).toBe(true);
    expect(host.querySelector(".cmdline")).toBe(null);
  });
});
