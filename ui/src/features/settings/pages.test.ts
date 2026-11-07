import { describe, expect, it } from "vitest";
import { SCHEMA_TEXT } from "../cmdline/__tests__/schemaText";
import { readSchema } from "../cmdline/schema";
import { choiceLabel, labelOf, PAGES, type PageId, pageOf, pageTitle } from "./pages";

describe("the Settings pages", () => {
  it("are the nine pages of 12-settings-theme-onboarding.md#settings, in order", () => {
    expect(PAGES.map((p) => p.title)).toEqual([
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
    expect(pageTitle("notes")).toBe("Notes and files");
    expect(pageTitle("nowhere" as PageId)).toBe("");
  });

  it("put each key on its page by group (F-045 criterion 1)", () => {
    expect(pageOf("ui.performance")).toBe("performance");
    expect(pageOf("ui.performanceX")).toBe("appearance");
    expect(pageOf("ui.hintBar")).toBe("appearance");
    expect(pageOf("ui.theme")).toBe("appearance");
    expect(pageOf("ai.defaultFast")).toBe("providers");
    expect(pageOf("ai.defaultStrong")).toBe("providers");
    expect(pageOf("ai.backupProvider")).toBe("providers");
    expect(pageOf("ai.hedgeAfterMs")).toBe("providers");
    expect(pageOf("ai.webSearch")).toBe("ai");
    expect(pageOf("ai.budget.daily")).toBe("ai");
    expect(pageOf("index.embeddings")).toBe("courses");
    expect(pageOf("lectures.namePattern")).toBe("courses");
    expect(pageOf("parsing.vision")).toBe("notes");
    expect(pageOf("figures.mode.page")).toBe("notes");
    expect(pageOf("privacy.shareFeedback")).toBe("privacy");
    expect(pageOf("feedback.endpoint")).toBe("privacy");
    expect(pageOf("log.content")).toBe("privacy");
    expect(pageOf("limits.providerLineBytes")).toBe("advanced");
    // A group's name alone, or a key no rule names, goes to Advanced.
    expect(pageOf("ui")).toBe("advanced");
    expect(pageOf("pluginX.y")).toBe("advanced");
  });

  it("give every page but Keys a setting of the committed schema", () => {
    const pages = new Set(readSchema(SCHEMA_TEXT).map((s) => pageOf(s.key)));
    expect([...PAGES.map((p) => p.id)].filter((id) => !pages.has(id))).toEqual(["keys"]);
  });

  it("label a key by its parts after the group", () => {
    expect(labelOf("ui.hintBar")).toBe("Hint bar");
    expect(labelOf("ai.search.allowDomains")).toBe("Search › allow domains");
    expect(labelOf("ai.hedgeAfterMs")).toBe("Hedge after ms");
    expect(labelOf("index.embeddings")).toBe("Embeddings");
    expect(labelOf("standalone")).toBe("Standalone");
    expect(choiceLabel("local-small")).toBe("Local small");
    expect(choiceLabel("off")).toBe("Off");
  });
});
