import { cleanup, render, screen } from "@solidjs/testing-library";
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

  it("shows the version the core reports in the status line", async () => {
    render(() => <App />);
    const status = screen.getByRole("status", { name: "Status line" });
    expect(await screen.findByText("v4.5.6")).toBeTruthy();
    expect(status.textContent).toContain("v4.5.6");
  });
});
