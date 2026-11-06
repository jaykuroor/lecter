import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { fakeSettingsCore } from "./__tests__/fakeCore";
import { createSettings, UNREAD } from "./state";

const keys = (w: ReturnType<typeof createSettings>) => w.shown().map((e) => e.spec.key);

function make(core = fakeSettingsCore()) {
  return createRoot((dispose) => ({ core, w: createSettings(core), dispose }));
}

describe("the Settings window's state", () => {
  it("opens on Appearance with the schema's settings and the values in force (F-045 criterion 1)", async () => {
    const { core, w, dispose } = make();
    expect(w.isOpen()).toBe(false);
    await w.open();
    expect(w.isOpen()).toBe(true);
    expect(w.page()).toBe("appearance");
    expect(keys(w)).toEqual(["ui.hintBar", "ui.keystrokes", "ui.theme"]);
    expect(w.values()["ui.hintBar"]?.value).toBe('"full"');
    expect(w.themes()).toEqual(["Adwaita", "Nord"]);
    // The schema and the themes are asked for once; the values at every open.
    w.close();
    await w.open("performance");
    expect(keys(w)).toEqual(["ui.performance"]);
    expect(core.calls).toEqual(["themes", "schema", "values null", "values null"]);
    dispose();
  });

  it("asks for the values with the open course", async () => {
    const core = fakeSettingsCore();
    core.open = { path: "/c/STAT311", name: "STAT311", trusted: false };
    const { w, dispose } = make(core);
    await w.open();
    expect(core.calls).toContain("values /c/STAT311");
    dispose();
  });

  it("says when the settings couldn't be read, and asks again at the next open", async () => {
    const core = fakeSettingsCore();
    core.failSchema = true;
    const { w, dispose } = make(core);
    await w.open();
    expect(w.loadError()).toBe(UNREAD);
    expect(keys(w)).toEqual([]);
    w.close();
    await w.open();
    expect(w.loadError()).toBeNull();
    expect(keys(w)).toEqual(["ui.hintBar", "ui.keystrokes", "ui.theme"]);
    expect(core.calls.filter((c) => c === "schema")).toHaveLength(2);
    dispose();
  });

  it("searches every page, and a page shown clears the search (F-045 criterion 1)", async () => {
    const { w, dispose } = make();
    await w.open();
    w.setQuery("preset");
    expect(keys(w)).toEqual(["ui.performance"]);
    w.setQuery("domains");
    expect(keys(w)).toEqual(["ai.search.allowDomains", "ai.search.blockDomains"]);
    w.showPage("privacy");
    expect(w.query()).toBe("");
    expect(keys(w)).toEqual(["feedback.endpoint", "log.content", "privacy.shareFeedback", "privacy.shareFeedbackText"]);
    w.close();
    expect(w.query()).toBe("");
    dispose();
  });

  it("writes a change to the global file and shows the value then in force (F-045 criterion 2)", async () => {
    const { core, w, dispose } = make();
    await w.open();
    expect(await w.write("ui.hintBar", '"compact"')).toBe(true);
    expect(core.calls.at(-1)).toBe('set ui.hintBar="compact" null global');
    expect(w.values()["ui.hintBar"]).toMatchObject({ value: '"compact"', source: "global" });
    dispose();
  });

  it("writes to the course's own file only when one is open and trusted (F-045 criterion 2)", async () => {
    const core = fakeSettingsCore();
    const { w, dispose } = make(core);
    await w.open();
    // No course: "This course" can't be chosen; a change goes to the global file.
    w.setScope("course");
    expect(w.courseScope()).toBe(false);
    expect(w.scope()).toBe("global");
    core.open = { path: "/c/STAT311", name: "STAT311", trusted: false };
    expect(w.scope()).toBe("global");
    core.open = { path: "/c/STAT311", name: "STAT311", trusted: true };
    w.setScope("global");
    w.setScope("course");
    expect(w.scope()).toBe("course");
    await w.write("ui.performance", '"quality"');
    expect(core.calls.at(-1)).toBe('set ui.performance="quality" /c/STAT311 course');
    expect(w.values()["ui.performance"]).toMatchObject({ value: '"quality"', source: "course" });
    dispose();
  });

  it("shows the core's reason under a refused setting, and clears it at the next try", async () => {
    const core = fakeSettingsCore();
    core.open = { path: "/c/STAT311", name: "STAT311", trusted: true };
    const { w, dispose } = make(core);
    await w.open();
    w.setScope("course");
    expect(await w.write("privacy.shareFeedback", "true")).toBe(false);
    expect(w.errors()["privacy.shareFeedback"]).toBe("privacy.shareFeedback can only be set in the global settings");
    expect(w.values()["privacy.shareFeedback"]?.value).toBe("false");
    w.setScope("global");
    expect(await w.write("privacy.shareFeedback", "true")).toBe(true);
    expect(w.errors()["privacy.shareFeedback"]).toBeUndefined();
    core.failSet = { code: "E_IO", message: "could not write config.jsonc", retryable: true };
    await w.write("ui.hintBar", '"off"');
    expect(w.errors()).toEqual({ "ui.hintBar": "could not write config.jsonc" });
    w.close();
    expect(w.errors()).toEqual({});
    dispose();
  });

  it("takes a change made elsewhere (settings:changed), and ignores a key it doesn't list", async () => {
    const { w, dispose } = make();
    await w.open();
    w.changed({ key: "ui.keystrokes", value: "false", source: "global" });
    expect(w.values()["ui.keystrokes"]).toMatchObject({ value: "false", source: "global", globalOnly: false });
    w.changed({ key: "ui.zoom", value: "2", source: "global" });
    expect(w.values()["ui.zoom"]).toBeUndefined();
    dispose();
  });
});
