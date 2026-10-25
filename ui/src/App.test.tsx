import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";

describe("App shell", () => {
  afterEach(cleanup);
  beforeEach(() =>
    installMockCore({
      ...defaultFixture,
      appInfo: { name: "Lecter", version: "4.5.6" },
    }),
  );

  it("renders the frame regions with labels", () => {
    render(() => <App />);
    expect(screen.getByRole("banner").textContent).toContain("Lecter");
    expect(screen.getByRole("navigation", { name: "Course rail" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "Document" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Side panel" })).toBeTruthy();
  });

  it("opens a lecture of the opened course into the buffer and marks it in the rail", async () => {
    const lecture = { path: "lectures/l07.md", name: "l07.md", text: "[Only block]{#s1b1}\n" };
    installMockCore({
      ...defaultFixture,
      courseOpen: { path: "/c/STAT311", name: "STAT311", lectures: [lecture], slides: [], trust: "trusted" },
      lectures: { [lecture.path]: lecture },
    });
    const asked: unknown[] = [];
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      asked.push([cmd, args ?? null]);
      return invoke(cmd, args);
    };
    const { container } = render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: /open course folder/i }));
    const row = await screen.findByRole("button", { name: "l07.md" });
    expect(row.getAttribute("aria-current")).toBeNull();
    fireEvent.click(row);
    await waitFor(() => expect(container.querySelector(".cm-block")?.textContent).toBe("Only block"));
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(asked.at(-1)).toEqual(["lecture_open", { course: "/c/STAT311", path: "lectures/l07.md" }]);
  });

  it("shows the version the core reports in the status line", async () => {
    render(() => <App />);
    const status = screen.getByRole("status", { name: "Status line" });
    expect(await screen.findByText("v4.5.6")).toBeTruthy();
    expect(status.textContent).toContain("v4.5.6");
  });
});
