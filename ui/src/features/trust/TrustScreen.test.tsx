import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { TrustScreen as Screen, TrustChoice } from "../../core/course";
import { count, inside } from "./summary";
import { ReadOnlyChip, TrustScreen } from "./TrustScreen";

afterEach(cleanup);

/** A course with its own AI files, as the core lists them (02-course-folder.md#trust). */
const full: Screen = {
  lectures: 6,
  slides: 12,
  sources: 3,
  provider: "sample",
  webSearch: true,
  agents: ["AGENTS.md"],
  roles: [".lecter/agents/tutor.md"],
  skills: [".lecter/skills/flashcards"],
  overrides: ["ai.hedgeAfterMs", "ui.performance"],
  changed: false,
};

function show(s: Screen, busy = false): TrustChoice[] {
  const answers: TrustChoice[] = [];
  render(() => (
    <TrustScreen name="STAT311" path="/c/STAT311" screen={s} busy={busy} onAnswer={(c) => answers.push(c)} />
  ));
  return answers;
}

describe("the trust screen", () => {
  // Criterion 1: counts of slides, sources and lectures, the provider and web search.
  it("shows what is inside, the provider that receives excerpts and web search", () => {
    show(full);
    const dialog = screen.getByRole("dialog", { name: "Trust “STAT311”?" });
    expect(within(dialog).getByText("6 lectures · 12 slide decks · 3 sources")).toBeTruthy();
    expect(dialog.querySelector(".trust-provider")?.textContent).toBe("sample");
    expect(dialog.querySelector(".trust-web")?.textContent).toBe("On");
    expect(within(dialog).getByText("Everything in this folder except what .lecterignore lists")).toBeTruthy();
    cleanup();
    show({ ...full, webSearch: false });
    expect(document.querySelector(".trust-web")?.textContent).toBe("Off");
  });

  // Criterion 5: AGENTS.md, roles, skills and settings overrides are listed; empty ones say None.
  it("lists the course's AGENTS.md, roles, skills and settings overrides", () => {
    show(full);
    const items = (label: string) =>
      [...screen.getByRole("region", { name: label }).querySelectorAll("li")].map((li) => li.textContent);
    expect(items("Course instructions")).toEqual(["AGENTS.md"]);
    expect(items("Roles")).toEqual([".lecter/agents/tutor.md"]);
    expect(items("Skills")).toEqual([".lecter/skills/flashcards"]);
    expect(items("Settings overrides")).toEqual(["ai.hedgeAfterMs", "ui.performance"]);
    cleanup();
    show({ ...full, agents: [], roles: [], skills: [], overrides: [] });
    for (const label of ["Course instructions", "Roles", "Skills", "Settings overrides"]) {
      const group = screen.getByRole("region", { name: label });
      expect(group.querySelectorAll("li")).toHaveLength(0);
      expect(within(group).getByText("None")).toBeTruthy();
    }
  });

  it("says when it asks again because the AI files changed", () => {
    show(full);
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    show({ ...full, changed: true });
    expect(screen.getByRole("note").textContent).toContain("changed since you last answered");
  });

  // Criterion 2: both answers by mouse and by key; focus starts on the safe one.
  it("answers Trust or Open read-only by click, Enter or Space", () => {
    const answers = show(full);
    const readOnly = screen.getByRole("button", { name: "Open read-only" });
    const trust = screen.getByRole("button", { name: "Trust" });
    expect(document.activeElement).toBe(readOnly);
    fireEvent.click(trust);
    fireEvent.click(readOnly);
    fireEvent.keyDown(readOnly, { key: "Enter" });
    fireEvent.keyDown(trust, { key: " " });
    fireEvent.keyDown(trust, { key: "a" });
    expect(answers).toEqual(["trusted", "read_only", "read_only", "trusted"]);
  });

  it("takes no second answer while one is being saved", () => {
    const answers = show(full, true);
    const trust = screen.getByRole("button", { name: "Trust" }) as HTMLButtonElement;
    expect(trust.disabled).toBe(true);
    fireEvent.keyDown(trust, { key: "Enter" });
    expect(answers).toEqual([]);
  });

  it("marks a read-only course", () => {
    render(() => <ReadOnlyChip />);
    expect(screen.getByText("Read-only").title).toContain("no AI");
  });
});

describe("counts", () => {
  it("are singular only for exactly one", () => {
    expect([0, 1, 2].map((n) => count(n, "lecture", "lectures"))).toEqual(["0 lectures", "1 lecture", "2 lectures"]);
    expect(inside({ ...full, lectures: 1, slides: 1, sources: 1 })).toBe("1 lecture · 1 slide deck · 1 source");
  });
});
