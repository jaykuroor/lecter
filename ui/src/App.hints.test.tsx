import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";

// F-038: the hint bar shows above the status line once the key engine is in, with the keys of
// keymaps.jsonc laid over the defaults (D-199), from the engine's own keymap.

const tail = () => [...document.querySelectorAll(".hint-tail .hint")].map((h) => h.textContent);

describe("the app's hint bar", () => {
  afterEach(cleanup);

  it("shows above the status line once the engine is in, with the keys that work on the page", async () => {
    installMockCore({ ...defaultFixture, keymaps: null });
    render(() => <App />);
    await waitFor(() => expect(tail()).toEqual(["F6Next paneclick a pane", "␣Moreclick here"]));
    const bar = document.querySelector(".hint-bar");
    expect(bar?.parentElement?.nextElementSibling?.classList.contains("status-line")).toBe(true);
  });

  it("shows keymaps.jsonc's keys once the file is in", async () => {
    installMockCore({
      ...defaultFixture,
      keymaps:
        '{ "version": 1, "bindings": [{ "keys": "<F6>", "command": null }, { "keys": "<F7>", "command": "focus.next" }] }',
    });
    render(() => <App />);
    await waitFor(() => expect(tail()).toEqual(["F7Next paneclick a pane", "␣Moreclick here"]));
  });
});
