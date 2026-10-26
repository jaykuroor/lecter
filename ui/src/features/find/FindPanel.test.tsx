import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { FindHit } from "../../core/search";
import type { FindState } from "../../state/find";
import { FindPanel, status } from "./FindPanel";

const hit = (lecture: string, block: string, text: string, breadcrumb: string): FindHit => ({
  lecture,
  slide: block.slice(0, block.indexOf("b")),
  block,
  text,
  breadcrumb,
});

/** A FindState whose values the test sets directly. */
function fixedState(init: { query?: string; hits?: FindHit[]; error?: string | null; busy?: boolean }) {
  const [query, setQuery] = createSignal(init.query ?? "");
  const [hits, setHits] = createSignal(init.hits ?? []);
  const [error] = createSignal(init.error ?? null);
  const [busy] = createSignal(init.busy ?? false);
  const state: FindState = { query, hits, error, busy, run: async () => undefined };
  return { state, setQuery, setHits };
}

describe("FindPanel", () => {
  afterEach(cleanup);

  it("lists the hits in rank order with their lecture, block id, breadcrumb and text", () => {
    const hits = [
      hit(
        "lectures/2026-10-23-l07-covariance.md",
        "s2b2",
        "Variance of a sum adds twice the covariance.",
        "Covariance › Properties",
      ),
      hit("lectures/l08.md", "s1b1", "Residuals sum to zero.", "Regression › Fit"),
    ];
    const { state } = fixedState({ query: "sum", hits });
    const { container } = render(() => <FindPanel state={state} onFind={() => undefined} />);
    const rows = [...container.querySelectorAll(".find-hit")];
    expect(rows.map((r) => [r.getAttribute("data-lecture"), r.getAttribute("data-block")])).toEqual([
      ["lectures/2026-10-23-l07-covariance.md", "s2b2"],
      ["lectures/l08.md", "s1b1"],
    ]);
    expect(rows.map((r) => r.querySelector(".find-hit-where")?.textContent)).toEqual([
      "2026-10-23-l07-covariance.md · s2b2",
      "l08.md · s1b1",
    ]);
    expect(rows.map((r) => r.querySelector(".find-hit-crumb")?.textContent)).toEqual([
      "Covariance › Properties",
      "Regression › Fit",
    ]);
    expect(rows[0]?.querySelector(".find-hit-text")?.textContent).toBe("Variance of a sum adds twice the covariance.");
    expect(screen.getByRole("status").textContent).toBe("2 hits for “sum”");
    expect(screen.getByRole("list", { name: "Find results" })).toBeTruthy();
  });

  it("searches the field's words on Enter and on the Find button", () => {
    const asked: string[] = [];
    const { state } = fixedState({});
    render(() => <FindPanel state={state} onFind={(w) => asked.push(w)} />);
    const field = screen.getByRole("searchbox", { name: "Find in lectures" }) as HTMLInputElement;
    field.value = "covariance";
    fireEvent.keyDown(field, { key: "Enter" });
    field.value = "zero sum";
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    fireEvent.keyDown(field, { key: "a" });
    expect(asked).toEqual(["covariance", "zero sum"]);
  });

  it("shows the words of a :find in the field", () => {
    const { state, setQuery } = fixedState({});
    render(() => <FindPanel state={state} onFind={() => undefined} />);
    setQuery("bilinear");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("bilinear");
  });

  it("shows an error as an alert and no hit list", () => {
    const { state } = fixedState({ query: "x", error: "Open a course to search its lectures." });
    const { container } = render(() => <FindPanel state={state} onFind={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toBe("Open a course to search its lectures.");
    expect(container.querySelector(".find-hits")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("the status line says searching, none, one or many", () => {
    const at = (init: Parameters<typeof fixedState>[0]) => status(fixedState(init).state);
    const one = [hit("lectures/l.md", "s1b1", "a", "b")];
    expect(at({})).toBe("");
    expect(at({ query: "zero", busy: true })).toBe("Searching for “zero”…");
    expect(at({ query: "zero" })).toBe("No hits for “zero”");
    expect(at({ query: "zero", hits: one })).toBe("1 hit for “zero”");
    expect(at({ query: "zero", hits: [...one, ...one] })).toBe("2 hits for “zero”");
    expect(at({ query: "zero", error: "nope" })).toBe("");
  });
});
