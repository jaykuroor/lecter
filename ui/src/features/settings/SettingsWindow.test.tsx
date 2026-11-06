import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { type FakeSettingsCore, fakeSettingsCore } from "./__tests__/fakeCore";
import { SettingsWindow } from "./SettingsWindow";
import { createSettings } from "./state";

// 12-settings-theme-onboarding.md#settings: the window renders a control for every setting of the
// schema on its page, searches them, writes a change to the right file, and every control is
// reachable by key.

afterEach(cleanup);

const LAG = "Can add input lag on slower machines.";

interface Opened {
  core: FakeSettingsCore;
  closed: () => number;
  dialog: HTMLElement;
}

async function opened(core = fakeSettingsCore(DEFAULTS)): Promise<Opened> {
  const settings = createRoot(() => createSettings(core));
  let closes = 0;
  render(() => (
    <SettingsWindow
      settings={settings}
      course={core.course}
      bindings={() => DEFAULT_KEYMAP}
      mac={false}
      onClose={() => {
        closes += 1;
      }}
    />
  ));
  await settings.open();
  await waitFor(() => expect(document.querySelector(".settings-row")).not.toBeNull());
  return { core, closed: () => closes, dialog: screen.getByRole("dialog", { name: "Settings" }) };
}

/** The values of a new install: each setting's built-in default (crates/core settings.schema.json). */
const DEFAULTS = {
  "ui.performance": { value: '"balanced"', source: "default" as const },
  "ui.hintBar": { value: '"full"', source: "default" as const },
  "ui.keystrokes": { value: "true", source: "default" as const },
  "ui.theme": { value: "null", source: "default" as const },
  "ai.hedgeAfterMs": { value: "1500", source: "default" as const },
};

const key = (target: Element, k: string, extra: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(e);
  return e;
};
const active = () => document.activeElement as HTMLElement;
const rowOf = (el: Element | null) => el?.closest(".settings-row")?.getAttribute("data-key");
const tab = (name: string) => screen.getByRole("tab", { name });

describe("the Settings window", () => {
  it("has the nine pages, and renders Appearance's settings from the schema (F-045 criterion 1)", async () => {
    await opened();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Appearance",
      "Keys",
      "AI",
      "Providers",
      "Courses",
      "Notes and files",
      "Performance",
      "Privacy",
      "Advanced",
    ]);
    expect(tab("Appearance").getAttribute("aria-selected")).toBe("true");
    const hint = screen.getByRole("radiogroup", { name: "Hint bar" });
    expect([...hint.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["Full", "Compact", "Off"]);
    expect((hint.querySelector("input:checked") as HTMLInputElement).value).toBe('"full"');
    expect((screen.getByRole("checkbox", { name: "Keystrokes" }) as HTMLInputElement).checked).toBe(true);
    const theme = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    expect([...theme.options].map((o) => o.textContent)).toEqual(["Follow the desktop", "Adwaita", "Nord"]);
    expect(theme.value).toBe("");
    // Each setting says what `:set` calls it and where its value comes from.
    const row = document.querySelector('[data-key="ui.hintBar"]') as HTMLElement;
    expect(row.querySelector(".settings-key")?.textContent).toBe("ui.hintBar");
    expect(row.querySelector(".settings-source")?.textContent).toBe("default");
    expect(row.querySelector(".settings-desc")?.textContent).toBe("How much the hint bar shows.");
  });

  it("renders every kind of control: a list for more than four choices, fields for numbers and lists", async () => {
    await opened();
    fireEvent.click(tab("AI"));
    const service = screen.getByRole("combobox", { name: "Search › service" }) as HTMLSelectElement;
    expect([...service.options].map((o) => o.textContent)).toEqual(["Brave", "Tavily", "Exa", "Searxng", "Not set"]);
    expect(screen.getByRole("radiogroup", { name: "Web search" })).not.toBeNull();
    fireEvent.click(tab("Providers"));
    expect((screen.getByRole("textbox", { name: "Hedge after ms" }) as HTMLInputElement).value).toBe("1500");
    expect((screen.getByRole("textbox", { name: "Default fast" }) as HTMLInputElement).value).toBe("");
    fireEvent.click(tab("Keys"));
    expect(screen.getByRole("list", { name: "Keys" }).textContent).toContain("Settings");
    expect(screen.getByRole("list", { name: "Keys" }).textContent).toContain("Ctrl-,");
  });

  it("writes a change at once and shows the value then in force (F-045 criterion 2)", async () => {
    const { core } = await opened();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    await waitFor(() => expect(core.calls.at(-1)).toBe('set ui.hintBar="compact" null global'));
    await waitFor(() =>
      expect(document.querySelector('[data-key="ui.hintBar"] .settings-source')?.textContent).toBe("global"),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Keystrokes" }));
    await waitFor(() => expect(core.calls.at(-1)).toBe("set ui.keystrokes=false null global"));
    const theme = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    fireEvent.change(theme, { target: { value: "Nord" } });
    await waitFor(() => expect(core.calls.at(-1)).toBe('set ui.theme="Nord" null global'));
    fireEvent.change(theme, { target: { value: "" } });
    await waitFor(() => expect(core.calls.at(-1)).toBe("set ui.theme=null null global"));
  });

  it("checks a typed value against the schema before writing it, and says why it is refused", async () => {
    const { core } = await opened();
    fireEvent.click(tab("Providers"));
    const field = screen.getByRole("textbox", { name: "Hedge after ms" }) as HTMLInputElement;
    field.value = "soon";
    key(field, "Enter");
    expect(screen.getByRole("alert").textContent).toBe("ai.hedgeAfterMs must be a whole number from 0 to 4294967295");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(core.calls.some((c) => c.startsWith("set "))).toBe(false);
    field.value = "900";
    fireEvent.change(field);
    await waitFor(() => expect(core.calls.at(-1)).toBe("set ai.hedgeAfterMs=900 null global"));
    expect(screen.queryByRole("alert")).toBeNull();
    // The same value again writes nothing.
    key(field, "Enter");
    expect(core.calls.filter((c) => c.startsWith("set "))).toHaveLength(1);
  });

  it("offers Performance, Balanced and Quality with Balanced picked, and notes Quality's lag (F-045 criterion 4)", async () => {
    const { core } = await opened();
    fireEvent.click(tab("Performance"));
    const group = screen.getByRole("radiogroup", { name: "Performance" });
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(["performance", "balanced", "quality"]);
    expect([...group.querySelectorAll(".settings-preset-title")].map((t) => t.textContent)).toEqual([
      "Performance",
      "Balanced",
      "Quality",
    ]);
    expect(radios.find((r) => r.checked)?.value).toBe("balanced");
    expect(document.body.textContent).not.toContain(LAG);
    fireEvent.click(screen.getByRole("radio", { name: /^Quality/ }));
    await waitFor(() => expect(screen.getByRole("note").textContent).toBe(LAG));
    expect(core.calls.at(-1)).toBe('set ui.performance="quality" null global');
    fireEvent.click(screen.getByRole("radio", { name: /^Performance/ }));
    await waitFor(() => expect(screen.queryByRole("note")).toBeNull());
  });

  it("searches every page, and says when nothing matches (F-045 criterion 1)", async () => {
    await opened();
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    fireEvent.input(search, { target: { value: "budget daily" } });
    expect([...document.querySelectorAll(".settings-row")].map(rowOf)).toEqual(["ai.budget.daily"]);
    expect(document.querySelector(".settings-page-title")?.textContent).toBe("Settings matching “budget daily”");
    expect(screen.getAllByRole("tab").every((t) => t.getAttribute("aria-selected") === "false")).toBe(true);
    fireEvent.input(search, { target: { value: "zzz" } });
    expect(document.querySelector(".settings-empty")?.textContent).toBe("No setting matches.");
    fireEvent.click(tab("Privacy"));
    expect((search as HTMLInputElement).value).toBe("");
    expect([...document.querySelectorAll(".settings-row")].map(rowOf)).toEqual([
      "feedback.endpoint",
      "log.content",
      "privacy.shareFeedback",
      "privacy.shareFeedbackText",
    ]);
  });

  it("writes to the course only when one is open and trusted; global-only settings stay global (F-045 criterion 2)", async () => {
    const core = fakeSettingsCore(DEFAULTS);
    const { core: c } = await opened(core);
    const courseChoice = screen.getByRole("radio", { name: "This course" }) as HTMLInputElement;
    expect(courseChoice.disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Global" }) as HTMLInputElement).checked).toBe(true);
    cleanup();
    c.open = { path: "/c/STAT311", name: "STAT311", trusted: true };
    await opened(c);
    const course = screen.getByRole("radio", { name: "This course (STAT311)" }) as HTMLInputElement;
    expect(course.disabled).toBe(false);
    fireEvent.click(course);
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    await waitFor(() => expect(c.calls.at(-1)).toBe('set ui.hintBar="off" /c/STAT311 course'));
    fireEvent.click(tab("Privacy"));
    const share = screen.getByRole("checkbox", { name: "Share feedback" }) as HTMLInputElement;
    expect(share.disabled).toBe(true);
    const row = share.closest(".settings-row") as HTMLElement;
    expect(row.querySelector(".settings-note")?.textContent).toBe("Only the global settings can set this.");
    fireEvent.click(screen.getByRole("radio", { name: "Global" }));
    expect(share.disabled).toBe(false);
    expect(row.querySelector(".settings-note")).toBeNull();
  });

  it("says when the course's own value stays in force over a global change", async () => {
    const core = fakeSettingsCore({ ...DEFAULTS, "ui.hintBar": { value: '"off"', source: "course" } });
    core.open = { path: "/c/STAT311", name: "STAT311", trusted: true };
    await opened(core);
    const row = document.querySelector('[data-key="ui.hintBar"]') as HTMLElement;
    expect(row.querySelector(".settings-source")?.textContent).toBe("this course");
    expect(row.querySelector(".settings-note")?.textContent).toBe(
      "This course sets its own value, which stays in force here.",
    );
  });

  it("shows the core's refusal under the setting", async () => {
    const core = fakeSettingsCore(DEFAULTS);
    core.failSet = { code: "E_IO", message: "could not write config.jsonc", retryable: true };
    await opened(core);
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("could not write config.jsonc"));
  });
});

describe("the Settings window by key (F-045 criterion 3)", () => {
  it("moves through the pages with ↑/↓, j/k, Home and End, and keeps one Tab stop there", async () => {
    await opened();
    tab("Appearance").focus();
    key(active(), "ArrowDown");
    expect(active()).toBe(tab("Keys"));
    expect(tab("Keys").getAttribute("aria-selected")).toBe("true");
    expect(tab("Keys").tabIndex).toBe(0);
    expect(tab("Appearance").tabIndex).toBe(-1);
    key(active(), "j");
    expect(active()).toBe(tab("AI"));
    key(active(), "k");
    key(active(), "ArrowUp");
    expect(active()).toBe(tab("Appearance"));
    key(active(), "ArrowUp");
    expect(active()).toBe(tab("Advanced"));
    key(active(), "Home");
    expect(active()).toBe(tab("Appearance"));
    key(active(), "End");
    expect(active()).toBe(tab("Advanced"));
    expect(key(active(), "x").defaultPrevented).toBe(false);
  });

  it("goes from setting to setting with j/k, and from the search into what it found", async () => {
    await opened();
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    search.focus();
    key(search, "ArrowDown");
    expect(rowOf(active())).toBe("ui.hintBar");
    // The picked choice of a group takes the focus.
    expect((active() as HTMLInputElement).value).toBe('"full"');
    key(active(), "j");
    expect(rowOf(active())).toBe("ui.keystrokes");
    // ↓ on a switch moves on too; a list keeps its arrows.
    key(active(), "ArrowDown");
    expect(rowOf(active())).toBe("ui.theme");
    expect(key(active(), "ArrowDown").defaultPrevented).toBe(false);
    expect(rowOf(active())).toBe("ui.theme");
    key(active(), "j");
    expect(rowOf(active())).toBe("ui.theme");
    key(active(), "k");
    key(active(), "k");
    key(active(), "k");
    expect(rowOf(active())).toBe("ui.hintBar");
    // A radio group keeps ↑/↓ for its own choices.
    expect(key(active(), "ArrowDown").defaultPrevented).toBe(false);
    // From the search, Enter goes in as ↓ does.
    fireEvent.input(search, { target: { value: "theme" } });
    key(search, "Enter");
    expect(rowOf(active())).toBe("ui.theme");
  });

  it("goes to the search with /, but types / in a field", async () => {
    await opened();
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    screen.getByRole("checkbox", { name: "Keystrokes" }).focus();
    expect(key(active(), "/").defaultPrevented).toBe(true);
    expect(active()).toBe(search);
    expect(key(search, "/").defaultPrevented).toBe(false);
    fireEvent.click(tab("Providers"));
    const field = screen.getByRole("textbox", { name: "Hedge after ms" });
    field.focus();
    expect(key(field, "/").defaultPrevented).toBe(false);
    expect(key(field, "j").defaultPrevented).toBe(false);
    expect(active()).toBe(field);
  });

  it("empties the search with Esc, then closes", async () => {
    const { closed } = await opened();
    const search = screen.getByRole("searchbox", { name: "Search settings" }) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "theme" } });
    search.focus();
    key(search, "Escape");
    expect(search.value).toBe("");
    expect(closed()).toBe(0);
    key(search, "Escape");
    expect(closed()).toBe(1);
    screen.getByRole("checkbox", { name: "Keystrokes" }).focus();
    key(active(), "Escape");
    expect(closed()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(closed()).toBe(3);
  });

  it("keeps Tab in the window: past the last control to the search, before the first to the last", async () => {
    const { dialog } = await opened();
    const [first, last] = [...dialog.querySelectorAll<HTMLElement>(".settings-sentinel")];
    last?.focus();
    expect(active()).toBe(screen.getByRole("searchbox", { name: "Search settings" }));
    first?.focus();
    expect(rowOf(active())).toBe("ui.theme");
    fireEvent.click(tab("Keys"));
    first?.focus();
    expect(active().classList.contains("settings-keys-row")).toBe(true);
    // A page with no rows: the page's tab is the last stop.
    fireEvent.input(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "zzz" } });
    first?.focus();
    expect(active()).toBe(tab("Keys"));
  });

  it("takes no key with Ctrl, Alt or Cmd held: those go on to the app", async () => {
    await opened();
    tab("Appearance").focus();
    expect(key(active(), "j", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(active(), "Escape", { metaKey: true }).defaultPrevented).toBe(false);
    expect(active()).toBe(tab("Appearance"));
  });
});
