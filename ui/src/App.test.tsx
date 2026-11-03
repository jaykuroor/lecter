import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
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
    // The status line's app_info and the startup marks come after the first paint, in between.
    expect(asked.filter((call) => (call as unknown[])[0] === "lecture_open")).toEqual([
      ["lecture_open", { course: "/c/STAT311", path: "lectures/l07.md" }],
    ]);
  });

  it(":find in the buffer lists the open course's hits in the side panel (F-022)", async () => {
    const lecture = { path: "lectures/l07.md", name: "l07.md", text: "[Zero for independent variables.]{#s1b1}\n" };
    const hit = {
      lecture: lecture.path,
      slide: "s1",
      block: "s1b1",
      text: "Zero for independent variables.",
      breadcrumb: "L07",
    };
    installMockCore({
      ...defaultFixture,
      courseOpen: { path: "/c/STAT311", name: "STAT311", lectures: [lecture], slides: [], trust: "trusted" },
      lectures: { [lecture.path]: lecture },
      find: { variables: [hit] },
    });
    const { container } = render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: /open course folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
    await waitFor(() => expect(container.querySelector(".cm-block")).not.toBeNull());
    const editor = container.querySelector(".cm-editor") as HTMLElement;
    const cm = getCM(EditorView.findFromDOM(editor) as EditorView) as Parameters<typeof Vim.handleEx>[0];
    Vim.handleEx(cm, "find variables");
    const panel = screen.getByRole("region", { name: "Find" });
    const results = await within(panel).findByRole("list", { name: "Find results" });
    expect([...results.children].map((r) => r.getAttribute("data-block"))).toEqual(["s1b1"]);
    expect(within(panel).getByRole("status").textContent).toBe("1 hit for “variables”");
    expect((screen.getByRole("searchbox", { name: "Find in lectures" }) as HTMLInputElement).value).toBe("variables");
    const w = window as unknown as { __mockFinds?: unknown[] };
    expect(w.__mockFinds?.at(-1)).toEqual({ course: "/c/STAT311", query: "variables" });
  });

  it("a on a block of the open lecture asks the core about it, for that course and lecture (F-023)", async () => {
    const lecture = { path: "lectures/l07.md", name: "l07.md", text: "[Only block]{#s1b1}\n" };
    installMockCore({
      ...defaultFixture,
      courseOpen: { path: "/c/STAT311", name: "STAT311", lectures: [lecture], slides: [], trust: "trusted" },
      lectures: { [lecture.path]: lecture },
    });
    const asked: [string, unknown][] = [];
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      asked.push([cmd, args ?? null]);
      return invoke(cmd, args);
    };
    const { container } = render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: /open course folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
    await waitFor(() => expect(container.querySelector(".cm-block")).not.toBeNull());
    const editor = container.querySelector(".cm-editor") as HTMLElement;
    Vim.handleKey(
      getCM(EditorView.findFromDOM(editor) as EditorView) as Parameters<typeof Vim.handleKey>[0],
      "a",
      "user",
    );
    const input = container.querySelector(".gloss-prompt-input") as HTMLTextAreaElement;
    input.value = "why?";
    fireEvent.keyDown(input, { key: "Enter" });
    const request = asked.find(([cmd]) => cmd === "gloss_request")?.[1] as Record<string, unknown> | undefined;
    expect([request?.course, request?.path, request?.block, request?.question]).toEqual([
      "/c/STAT311",
      "lectures/l07.md",
      "s1b1",
      "why?",
    ]);
  });

  it("searching before a course is open explains instead of failing", () => {
    render(() => <App />);
    const panel = screen.getByRole("region", { name: "Find" });
    (within(panel).getByRole("searchbox") as HTMLInputElement).value = "variables";
    fireEvent.click(within(panel).getByRole("button", { name: "Find" }));
    expect(within(panel).getByRole("alert").textContent).toBe("Open a course to search its lectures.");
  });

  it("shows the version the core reports in the status line", async () => {
    render(() => <App />);
    const status = screen.getByRole("status", { name: "Status line" });
    expect(await screen.findByText("v4.5.6")).toBeTruthy();
    expect(status.textContent).toContain("v4.5.6");
  });
});
