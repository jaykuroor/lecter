import { describe, expect, it } from "vitest";
import { DEFAULT_HINT_DETAIL, nextDetail } from "./detail";

// ui.hintBar (12-settings-theme-onboarding.md#settings): full | compact | off, full by default
// (D-206); ␣uh steps through them (10-keymap.md#leader-groups).

describe("ui.hintBar's detail", () => {
  it("is full before anything sets it (D-206)", () => {
    expect(DEFAULT_HINT_DETAIL).toBe("full");
  });

  it("steps full → compact → off → full", () => {
    expect(nextDetail("full")).toBe("compact");
    expect(nextDetail("compact")).toBe("off");
    expect(nextDetail("off")).toBe("full");
  });
});
