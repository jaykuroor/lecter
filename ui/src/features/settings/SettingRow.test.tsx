import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { fakeSettingsCore } from "./__tests__/fakeCore";
import { DEFAULTS, key, opened, row } from "./__tests__/openWindow";

// One setting's row (F-045 criteria 1 and 2): the control its kind takes, showing the value in
// force, where it comes from, and what a change writes.

afterEach(cleanup);

const writes = (calls: string[]) => calls.filter((c) => c.startsWith("set "));
const tab = (name: string) => screen.getByRole("tab", { name });

describe("a setting's row", () => {
  it("says where its value comes from: the default, the global file or this course", async () => {
    const core = fakeSettingsCore({
      ...DEFAULTS,
      "ui.hintBar": { value: '"off"', source: "course" },
      "ui.keystrokes": { value: "false", source: "global" },
    });
    await opened(core);
    expect(row("ui.hintBar").querySelector(".settings-source")?.textContent).toBe("this course");
    expect(row("ui.keystrokes").querySelector(".settings-source")?.textContent).toBe("global");
    expect(row("ui.theme").querySelector(".settings-source")?.textContent).toBe("default");
    // Only a course's own value gets the note, and only while changes go to the global file.
    expect(row("ui.keystrokes").querySelector(".settings-note")).toBeNull();
    expect(row("ui.theme").querySelector(".settings-note")).toBeNull();
    expect(row("ui.hintBar").className).toBe("settings-row");
  });

  it("shows on/off as a switch, and writes true or false", async () => {
    const core = fakeSettingsCore({ ...DEFAULTS, "ui.keystrokes": { value: "false", source: "default" } });
    await opened(core);
    const box = screen.getByRole("checkbox", { name: "Keystrokes" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(writes(core.calls)).toEqual(["set ui.keystrokes=true null global"]));
    expect(box.checked).toBe(true);
  });

  it("shows up to four choices as buttons with the value picked, more as a list", async () => {
    const core = fakeSettingsCore({
      ...DEFAULTS,
      "parsing.vision": { value: '"auto"', source: "default" },
      "ai.search.service": { value: '"exa"', source: "global" },
    });
    await opened(core);
    const hint = screen.getByRole("radiogroup", { name: "Hint bar" });
    expect([...hint.querySelectorAll<HTMLInputElement>("input")].map((r) => r.checked)).toEqual([true, false, false]);
    fireEvent.click(tab("Notes and files"));
    const vision = screen.getByRole("radiogroup", { name: "Vision" });
    expect([...vision.querySelectorAll("label")].map((l) => l.textContent)).toEqual([
      "Provider",
      "Local",
      "Auto",
      "Off",
    ]);
    expect((vision.querySelector("input:checked") as HTMLInputElement).value).toBe('"auto"');
    fireEvent.click(tab("AI"));
    // Four values and "Not set": five, a list.
    const service = screen.getByRole("combobox", { name: "Search › service" }) as HTMLSelectElement;
    expect(service.value).toBe('"exa"');
    fireEvent.change(service, { target: { value: "null" } });
    await waitFor(() => expect(writes(core.calls)).toEqual(["set ai.search.service=null null global"]));
    expect(service.value).toBe("null");
  });

  it("lists the installed themes, and the one set now even when it isn't installed", async () => {
    const core = fakeSettingsCore({ ...DEFAULTS, "ui.theme": { value: '"Dracula"', source: "global" } });
    await opened(core);
    const theme = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    expect([...theme.options].map((o) => o.value)).toEqual(["", "Adwaita", "Nord", "Dracula"]);
    expect(theme.value).toBe("Dracula");
    cleanup();
    await opened(fakeSettingsCore({ ...DEFAULTS, "ui.theme": { value: '"Nord"', source: "global" } }));
    const nord = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    expect([...nord.options].map((o) => o.value)).toEqual(["", "Adwaita", "Nord"]);
    expect(nord.value).toBe("Nord");
    cleanup();
    await opened(fakeSettingsCore({ ...DEFAULTS, "ui.theme": { value: '"Adwaita"', source: "global" } }));
    expect((screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement).value).toBe("Adwaita");
  });

  it("gives fields a hint of what they take, and Enter commits without doing anything else", async () => {
    const { core } = await opened();
    fireEvent.click(tab("AI"));
    expect(screen.getByRole("textbox", { name: "Search › allow domains" }).getAttribute("placeholder")).toBe("a, b, c");
    fireEvent.click(tab("Providers"));
    const fast = screen.getByRole("textbox", { name: "Default fast" }) as HTMLInputElement;
    expect(fast.getAttribute("placeholder")).toBe("Not set");
    expect(screen.getByRole("textbox", { name: "Hedge after ms" }).getAttribute("placeholder")).toBe("");
    // An unset value left empty writes nothing; a new one is written as typed.
    expect(key(fast, "Enter").defaultPrevented).toBe(true);
    expect(writes(core.calls)).toEqual([]);
    fast.value = "fast-model";
    key(fast, "Enter");
    await waitFor(() => expect(writes(core.calls)).toEqual(['set ai.defaultFast="fast-model" null global']));
    expect(key(fast, "a").defaultPrevented).toBe(false);
  });

  it("writes a list as its items", async () => {
    const { core } = await opened();
    fireEvent.click(tab("AI"));
    const allow = screen.getByRole("textbox", { name: "Search › allow domains" }) as HTMLInputElement;
    allow.value = "a.edu, b.org";
    fireEvent.change(allow);
    await waitFor(() =>
      expect(writes(core.calls)).toEqual(['set ai.search.allowDomains=["a.edu","b.org"] null global']),
    );
    expect(allow.value).toBe("a.edu,b.org");
  });

  it("can't be changed for a course when only the global settings may set it (SEC-25)", async () => {
    const core = fakeSettingsCore({ ...DEFAULTS, "ui.hintBar": { value: '"off"', source: "course" } });
    core.open = { path: "/c/STAT311", name: "STAT311", trusted: true };
    await opened(core);
    fireEvent.click(screen.getByRole("radio", { name: "This course (STAT311)" }));
    // Changes go to the course now: its own value needs no note.
    expect(row("ui.hintBar").querySelector(".settings-note")).toBeNull();
    // A setting a course may set stays open to change.
    expect((screen.getByRole("checkbox", { name: "Keystrokes" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("radio", { name: "Compact" }).hasAttribute("disabled")).toBe(false);
    expect(row("ui.keystrokes").querySelector(".settings-note")).toBeNull();
    fireEvent.click(tab("Privacy"));
    const endpoint = screen.getByRole("textbox", { name: "Endpoint" }) as HTMLInputElement;
    expect(endpoint.disabled).toBe(true);
    fireEvent.click(tab("Advanced"));
    expect((screen.getByRole("textbox", { name: "Provider line bytes" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("lays the performance presets out under their setting", async () => {
    await opened();
    fireEvent.click(tab("Performance"));
    expect(row("ui.performance").className).toBe("settings-row settings-row-wide");
    expect(row("ui.performance").querySelector(".settings-source")?.textContent).toBe("default");
  });
});
