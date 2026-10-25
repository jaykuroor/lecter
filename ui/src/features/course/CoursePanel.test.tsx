import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import type { CourseOpened, IpcError } from "../../core/bindings";
import { createCourse } from "../../state/course";
import { CoursePanel } from "./CoursePanel";

const stat311: CourseOpened = {
  path: "/courses/STAT311",
  name: "STAT311",
  lectures: [
    { name: "2026-09-02-l01-introduction.md", path: "lectures/2026-09-02-l01-introduction.md" },
    { name: "2026-09-09-l02-probability.md", path: "lectures/2026-09-09-l02-probability.md" },
  ],
  slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
  trust: "ask",
};

function mount() {
  // One state per mount: a call inside the JSX prop would run again on every read of the prop.
  render(() => {
    const state = createCourse();
    return <CoursePanel state={state} />;
  });
  return screen.getByRole("button", { name: /open course folder/i });
}

/** Replaces the mocked core's `invoke` so `course_open` fails with `error`. */
function failCourseOpen(error: IpcError) {
  const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> } };
  w.__TAURI_INTERNALS__.invoke = () => Promise.reject(error);
}

describe("CoursePanel", () => {
  afterEach(cleanup);

  it("shows only the Open button before a course is opened", () => {
    installMockCore({ ...defaultFixture, courseOpen: stat311 });
    const open = mount();
    expect((open as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("region", { name: /^Course / })).toBeNull();
  });

  it("lists the opened course's lectures and slides by name, in the core's order", async () => {
    installMockCore({ ...defaultFixture, courseOpen: stat311 });
    fireEvent.click(mount());
    const course = await screen.findByRole("region", { name: "Course STAT311" });
    expect(within(course).getByRole("heading", { level: 2 }).textContent).toBe("STAT311");
    const lectures = within(course).getByRole("region", { name: "Lectures" });
    expect(
      within(lectures)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["2026-09-02-l01-introduction.md", "2026-09-09-l02-probability.md"]);
    expect(within(lectures).getByRole("heading").textContent).toBe("Lectures 2");
    const slides = within(course).getByRole("region", { name: "Slides" });
    expect(
      within(slides)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["07-covariance.pdf"]);
    expect(within(slides).getByRole("listitem").getAttribute("title")).toBe("slides/07-covariance.pdf");
  });

  it("says when a course has no lectures or slides yet", async () => {
    installMockCore({ ...defaultFixture, courseOpen: { ...stat311, lectures: [], slides: [] } });
    fireEvent.click(mount());
    expect(await screen.findByText("No lectures yet")).toBeTruthy();
    expect(screen.getByText("No slides yet")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows nothing new when the dialog is cancelled", async () => {
    installMockCore({ ...defaultFixture, courseOpen: null });
    const open = mount();
    fireEvent.click(open);
    await expect.poll(() => (open as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("region", { name: /^Course / })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the core's message when the course is refused (E_NOT_TRUSTED)", async () => {
    installMockCore({ ...defaultFixture, courseOpen: stat311 });
    failCourseOpen({
      code: "E_NOT_TRUSTED",
      message: "slides/07.pdf points outside the course folder; move it into the course or remove the link.",
      retryable: false,
    });
    fireEvent.click(mount());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "slides/07.pdf points outside the course folder; move it into the course or remove the link.",
    );
    expect(screen.queryByRole("region", { name: /^Course / })).toBeNull();
  });

  // Every action is reachable by key. The app handles Enter and Space itself instead of relying
  // on the browser's button activation, which synthetic key events (the embedded WebDriver,
  // assistive tools) never trigger.
  for (const key of ["Enter", " "]) {
    it(`opens the course on ${key === " " ? "Space" : key} on the focused button`, async () => {
      installMockCore({ ...defaultFixture, courseOpen: stat311 });
      const open = mount();
      open.focus();
      const handled = !fireEvent.keyDown(open, { key });
      expect(handled).toBe(true);
      expect(await screen.findByRole("region", { name: "Course STAT311" })).toBeTruthy();
    });
  }

  it("leaves other keys on the button alone", async () => {
    installMockCore({ ...defaultFixture, courseOpen: stat311 });
    const open = mount() as HTMLButtonElement;
    for (const key of ["a", "Tab", "Escape"]) {
      expect(fireEvent.keyDown(open, { key })).toBe(true);
    }
    expect(open.disabled).toBe(false);
    expect(screen.queryByRole("region", { name: /^Course / })).toBeNull();
  });

  it("disables the button while the dialog is open, so one click opens one dialog", async () => {
    installMockCore({ ...defaultFixture, courseOpen: stat311 });
    let calls = 0;
    let answer: (v: unknown) => void = () => {};
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> } };
    w.__TAURI_INTERNALS__.invoke = () => {
      calls += 1;
      return new Promise((resolve) => {
        answer = resolve;
      });
    };
    const open = mount() as HTMLButtonElement;
    fireEvent.click(open);
    fireEvent.click(open);
    expect(open.disabled).toBe(true);
    expect(calls).toBe(1);
    answer(stat311);
    expect(await screen.findByRole("region", { name: "Course STAT311" })).toBeTruthy();
    expect(open.disabled).toBe(false);
  });
});
