import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { CourseDetails } from "../../../core/course";
import { DetailsForm } from "./DetailsForm";

afterEach(cleanup);

/** What the core guesses for `STAT311 - Probability and Statistics` (02-course-folder.md). */
const guessed: CourseDetails = {
  name: "Probability and Statistics",
  code: "STAT 311",
  term: "",
  professor: "",
  icon: "S",
  color: "#3584e4",
  folders: { slides: "slides", sources: "sources", lectures: "lectures", pastPapers: "sources/past-papers" },
};

function show(opts: { details?: CourseDetails; busy?: boolean; error?: string | null } = {}) {
  const saved: CourseDetails[] = [];
  let skipped = 0;
  render(() => (
    <DetailsForm
      folder="STAT311 - Probability and Statistics"
      details={opts.details ?? guessed}
      busy={opts.busy ?? false}
      error={opts.error ?? null}
      onSave={(d) => saved.push(d)}
      onSkip={() => (skipped += 1)}
    />
  ));
  const dialog = screen.getByRole("dialog", { name: "Course details" });
  const field = (label: string) => within(dialog).getByLabelText(label) as HTMLInputElement;
  return { saved, skipped: () => skipped, dialog, field };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  fireEvent.input(input);
}

describe("the course details form", () => {
  // Criterion 1: name, code, term, professor, icon, colour and folder mapping, pre-filled.
  it("collects every detail, starting from the core's guesses", () => {
    const { field } = show();
    const shown = [
      "Name",
      "Code",
      "Term",
      "Professor",
      "Icon",
      "Colour",
      "Slides",
      "Sources",
      "Lectures",
      "Past papers",
    ].map((l) => field(l).value);
    expect(shown).toEqual([
      "Probability and Statistics",
      "STAT 311",
      "",
      "",
      "S",
      "#3584e4",
      "slides",
      "sources",
      "lectures",
      "sources/past-papers",
    ]);
    expect(field("Colour").type).toBe("color");
    expect(document.activeElement).toBe(field("Name"));
  });

  // Criterion 2's input: Save (mouse) sends every field as edited.
  it("saves what the user typed, by mouse", () => {
    const { saved, dialog, field } = show();
    type(field("Term"), "Fall 2026");
    type(field("Professor"), "Dr. Rivera");
    type(field("Icon"), "P");
    type(field("Colour"), "#e01b24");
    type(field("Past papers"), "sources/exams");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    expect(saved).toEqual([
      {
        ...guessed,
        term: "Fall 2026",
        professor: "Dr. Rivera",
        icon: "P",
        color: "#e01b24",
        folders: { ...guessed.folders, pastPapers: "sources/exams" },
      },
    ]);
  });

  // Every action by key too: Enter saves, Escape is Later; both keys show on the buttons.
  it("saves on Enter and closes on Escape, and shows both keys", () => {
    const { saved, skipped, dialog, field } = show();
    type(field("Professor"), "Dr. Rivera");
    // Both keys are the form's own: their default action (a submit, closing a native dialog) is stopped.
    expect(fireEvent.keyDown(field("Professor"), { key: "Enter" })).toBe(false);
    expect(saved).toEqual([{ ...guessed, professor: "Dr. Rivera" }]);
    expect(fireEvent.keyDown(field("Code"), { key: "Escape" })).toBe(false);
    expect(skipped()).toBe(1);
    // Other keys type as usual.
    expect(fireEvent.keyDown(field("Code"), { key: "a" })).toBe(true);
    expect(within(dialog).getByRole("button", { name: /^Save/ }).querySelector("kbd")?.textContent).toBe("Enter");
    expect(
      within(dialog)
        .getByRole("button", { name: /^Later/ })
        .querySelector("kbd")?.textContent,
    ).toBe("Esc");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Later/ }));
    expect(skipped()).toBe(2);
    expect(saved).toHaveLength(1);
  });

  // An Enter that composes text (an input method) isn't a save.
  it("ignores Enter while composing", () => {
    const { saved, field } = show();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(enter, "isComposing", { value: true });
    expect(field("Name").dispatchEvent(enter)).toBe(true);
    expect(saved).toEqual([]);
  });

  // A submit the platform raises itself (its own Enter) saves too, and never reloads the page.
  it("saves on the form's own submit", () => {
    const { saved, dialog } = show();
    expect(fireEvent.submit(dialog)).toBe(false);
    expect(saved).toEqual([guessed]);
  });

  // Focus starts in Name with its guess selected, so typing replaces it.
  it("selects the guessed name", () => {
    const { field } = show();
    const name = field("Name");
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, guessed.name.length]);
  });

  // The fields as the browser sees them: their types, names, limits, which one is required, no
  // spell checking, and the icon's hint tied to its field. Name and Icon span both columns.
  it("describes each field to the browser", () => {
    const { field } = show();
    const attrs = (label: string) => {
      const f = field(label);
      return [f.getAttribute("type"), f.name, f.maxLength, f.required, f.getAttribute("spellcheck"), f.className];
    };
    expect(attrs("Name")).toEqual(["text", "name", 200, true, "false", "details-input"]);
    expect(attrs("Code")).toEqual(["text", "code", 200, false, "false", "details-input"]);
    expect(attrs("Term")).toEqual(["text", "term", 200, false, "false", "details-input"]);
    expect(attrs("Professor")).toEqual(["text", "professor", 200, false, "false", "details-input"]);
    expect(attrs("Colour")).toEqual(["color", "color", 7, false, "false", "details-color"]);
    expect(attrs("Icon")).toEqual(["text", "icon", 255, false, "false", "details-input"]);
    expect(attrs("Past papers")).toEqual([
      "text",
      "folders.pastPapers",
      255,
      false,
      "false",
      "details-input details-path",
    ]);
    const hint = document.getElementById(field("Icon").getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("A letter, or an image in .lecter/ (e.g. .lecter/icon.png)");
    expect(field("Name").getAttribute("aria-describedby")).toBeNull();
    const wide = [...document.querySelectorAll(".details-field.wide label")].map((l) => l.textContent);
    expect(wide).toEqual(["Name", "Icon"]);
  });

  it("can't save without a name", () => {
    const { saved, dialog, field } = show();
    type(field("Name"), "   ");
    const save = within(dialog).getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.keyDown(field("Name"), { key: "Enter" });
    expect(saved).toEqual([]);
    type(field("Name"), "Stats");
    expect(save.disabled).toBe(false);
  });

  it("doesn't save twice while a save is in progress, and shows why one failed", () => {
    const { saved, dialog, field } = show({ busy: true, error: "The colour must be written #rrggbb, e.g. #3584e4." });
    fireEvent.keyDown(field("Name"), { key: "Enter" });
    expect(saved).toEqual([]);
    expect(within(dialog).getByRole("alert").textContent).toBe("The colour must be written #rrggbb, e.g. #3584e4.");
  });

  // The preview shows a text icon on the course's colour; an image path shows no letters.
  it("previews the icon on the chosen colour", () => {
    const { dialog, field } = show();
    const preview = dialog.querySelector(".details-icon") as HTMLElement;
    expect(preview.textContent).toBe("S");
    expect(preview.style.getPropertyValue("--c")).toBe("#3584e4");
    type(field("Colour"), "#2ec27e");
    expect(preview.style.getPropertyValue("--c")).toBe("#2ec27e");
    type(field("Icon"), ".lecter/icon.png");
    expect(preview.textContent).toBe("");
  });

  // The form keeps its own copy: editing it never changes the first values it was given.
  it("leaves the first values untouched", () => {
    const first = structuredClone(guessed);
    const { field } = show({ details: first });
    type(field("Slides"), "decks");
    type(field("Name"), "Stats");
    expect(first).toEqual(guessed);
  });
});
