import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../e2e/mock-core/fixture";
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

  // F-036: the sidebar shows at start; the headerbar button hides it and shows it again.
  it("hides and shows the sidebar from the headerbar, keeping the course rail", async () => {
    installMockCore({
      ...defaultFixture,
      courseOpen: {
        path: "/c/STAT311",
        name: "STAT311",
        lectures: [],
        slides: [],
        sources: [],
        trust: "trusted",
        screen: trustScreen,
      },
    });
    render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    await screen.findByRole("region", { name: "Course STAT311" });
    const toggle = within(screen.getByRole("banner")).getByRole("button", { name: "Sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("region", { name: "Course STAT311" })).toBeNull();
    expect(screen.getByRole("list", { name: "Courses" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: "Course STAT311" })).toBeTruthy();
  });

  // D-195: toggle the sidebar off, restart the app (a new App over the same core), still off.
  it("starts with the sidebar as the last run left it", async () => {
    installMockCore({ ...defaultFixture });
    render(() => <App />);
    const toggle = () => within(screen.getByRole("banner")).getByRole("button", { name: "Sidebar" });
    await waitFor(() => expect(toggle().getAttribute("aria-expanded")).toBe("true"));
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    cleanup();

    render(() => <App />);
    await waitFor(() => expect(toggle().getAttribute("aria-expanded")).toBe("false"));
    expect(document.getElementById("sidebar")?.hidden).toBe(true);
    const saved = (window as unknown as { __mockLayout?: unknown[] }).__mockLayout;
    expect(saved).toEqual([{ sidebar: false }]);
  });

  it("opens a lecture of the opened course into the buffer and marks it in the rail", async () => {
    const lecture = { path: "lectures/l07.md", name: "l07.md", text: "[Only block]{#s1b1}\n" };
    installMockCore({
      ...defaultFixture,
      courseOpen: {
        path: "/c/STAT311",
        name: "STAT311",
        lectures: [lecture],
        slides: [],
        sources: [],
        trust: "trusted",
        screen: trustScreen,
      },
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
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
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

  // F-033: a course still to be answered shows the trust screen over the document; the answer goes
  // to the core for that course and the screen closes. An answered course shows none.
  it("shows the trust screen for a course to be answered, and sends the answer (F-033)", async () => {
    const opened = { path: "/c/STAT311", name: "STAT311", lectures: [], slides: [], sources: [], screen: trustScreen };
    const w = window as unknown as { __mockTrust?: unknown[] };
    w.__mockTrust = [];
    installMockCore({ ...defaultFixture, courseOpen: { ...opened, trust: "ask" } });
    render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    const dialog = await screen.findByRole("dialog", { name: "Trust “STAT311”?" });
    expect(dialog.querySelector(".trust-path")?.textContent).toBe("/c/STAT311");
    fireEvent.click(within(dialog).getByRole("button", { name: "Open read-only" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(w.__mockTrust).toEqual([{ course: "/c/STAT311", choice: "read_only" }]);
    expect(screen.getByRole("heading", { level: 2, name: /STAT311/ }).textContent).toBe("STAT311 Read-only");
    cleanup();

    installMockCore({ ...defaultFixture, courseOpen: { ...opened, trust: "trusted" } });
    render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    await screen.findByRole("region", { name: "Course STAT311" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // F-034: Trust on a course without saved details brings the details form, titled with the
  // folder's name; Save sends the form to the core and closes it, and so does Later, without a save.
  it("shows the course details form after Trust, and Save or Later closes it (F-034)", async () => {
    const opened = {
      path: "/c/STAT311",
      name: "STAT311",
      lectures: [],
      slides: [],
      sources: [],
      trust: "ask" as const,
    };
    const details = {
      name: "STAT311",
      code: "STAT 311",
      term: "",
      professor: "",
      icon: "S",
      color: "#3584e4",
      folders: { slides: "slides", sources: "sources", lectures: "lectures", pastPapers: "sources/past-papers" },
    };
    const w = window as unknown as { __mockDetails?: unknown[] };
    for (const close of ["Save", "Later"]) {
      w.__mockDetails = [];
      installMockCore({ ...defaultFixture, courseOpen: { ...opened, screen: trustScreen }, details });
      render(() => <App />);
      fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
      const trust = await screen.findByRole("dialog", { name: "Trust “STAT311”?" });
      fireEvent.click(within(trust).getByRole("button", { name: "Trust" }));
      const form = await screen.findByRole("dialog", { name: "Course details" });
      expect(form.querySelector(".details-intro")?.textContent).toContain("For “STAT311”");
      fireEvent.click(within(form).getByRole("button", { name: new RegExp(`^${close}`) }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(w.__mockDetails).toEqual(close === "Save" ? [{ course: "/c/STAT311", details }] : []);
      cleanup();
    }
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
      courseOpen: {
        path: "/c/STAT311",
        name: "STAT311",
        lectures: [lecture],
        slides: [],
        sources: [],
        trust: "trusted",
        screen: trustScreen,
      },
      lectures: { [lecture.path]: lecture },
      find: { variables: [hit] },
    });
    const { container } = render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
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

  it("Enter on a block of the open lecture asks the core about it, for that course and lecture (F-023, F-048)", async () => {
    const lecture = { path: "lectures/l07.md", name: "l07.md", text: "[Only block]{#s1b1}\n" };
    installMockCore({
      ...defaultFixture,
      // No deltas: the mocked stream ends at once, so no timer of it outlives this file's jsdom.
      gloss: { deltas: [], deltaMs: 0 },
      courseOpen: {
        path: "/c/STAT311",
        name: "STAT311",
        lectures: [lecture],
        slides: [],
        sources: [],
        trust: "trusted",
        screen: trustScreen,
      },
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
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
    await waitFor(() => expect(container.querySelector(".cm-block")).not.toBeNull());
    // Enter asks (F-048) through the key engine, whose chunk comes after the editor's: press it
    // until the prompt opens.
    const content = container.querySelector(".cm-content") as HTMLElement;
    await waitFor(() => {
      if (!container.querySelector(".gloss-prompt-input")) fireEvent.keyDown(content, { key: "Enter" });
      expect(container.querySelector(".gloss-prompt-input")).not.toBeNull();
    });
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
