import type { Page } from "@playwright/test";
import { defaultFixture, expect, test, trustScreen } from "./mock-core";
import { sampleLecture } from "./mock-core/lectures";

// CI-bdabbe9: the document column keeps its grid track (09-ui.md#layout: rail | document | side
// panel) whatever its rows hold. The hint bar (F-038) and the status line's keymaps.jsonc notice
// (D-199) are one line each, cut where the line ends; their full width must never widen the
// column. When it did (the hint bar's keys are wider than the column in a window under ~1080 px,
// as on the macOS CI runner, whose screen holds the window to 1024 x 684), the buffer grew under
// the side panel: its lines wrapped wider (the 300-slide fixture 5.5 % shorter) and the webview
// painted a wider buffer over another pane, which is where rss_300_slides_mb's rise on macOS
// came from (+58 MB).

const lecturePath = "lectures/2026-10-23-l07-covariance.md";
/** A keymaps.jsonc error far longer than any status line. */
const longError = `keymaps.jsonc line 3: ${"an unknown command name in a binding, ".repeat(12)}`;

test.use({
  mockCore: {
    ...defaultFixture,
    courseOpen: {
      path: "/courses/STAT311",
      name: "STAT311",
      lectures: [{ name: "2026-10-23-l07-covariance.md", path: lecturePath }],
      slides: [],
      sources: [],
      trust: "trusted",
      screen: trustScreen,
    },
    lectures: { [lecturePath]: { path: lecturePath, name: "2026-10-23-l07-covariance.md", text: sampleLecture } },
    keymaps: { error: longError },
  },
});

/** Each pane's left and right edge, and the hint bar's own width before anything cuts it. */
interface Boxes {
  rail: [number, number];
  column: [number, number];
  buffer: [number, number];
  scroller: [number, number];
  hints: [number, number];
  status: [number, number];
  side: [number, number];
  /** The hint bar's min-content width: its keys laid out with no width to fit in. */
  hintsMinContent: number;
  /** The status line's notice at its full width. */
  noticeMaxContent: number;
}

async function boxes(page: Page): Promise<Boxes> {
  return await page.evaluate(() => {
    const edges = (sel: string): [number, number] => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no ${sel}`);
      const r = el.getBoundingClientRect();
      return [r.left, r.right];
    };
    /** `sel`'s width laid out alone, at `width` (min-content or max-content). */
    const intrinsic = (sel: string, width: string): number => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no ${sel}`);
      const copy = el.cloneNode(true) as HTMLElement;
      copy.style.cssText = `position: absolute; visibility: hidden; width: ${width}`;
      (el.parentElement as HTMLElement).append(copy);
      const w = copy.getBoundingClientRect().width;
      copy.remove();
      return w;
    };
    return {
      rail: edges(".rail"),
      column: edges(".document-column"),
      buffer: edges(".buffer"),
      scroller: edges(".cm-scroller"),
      hints: edges(".hint-bar-host"),
      status: edges(".status-line"),
      side: edges(".side-panel"),
      hintsMinContent: intrinsic(".hint-bar", "min-content"),
      noticeMaxContent: intrinsic(".keys-notice", "max-content"),
    };
  });
}

for (const width of [1280, 960]) {
  test(`the hint bar and the status line never widen the document column (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "Add a course" }).click();
    await page.getByRole("button", { name: "2026-10-23-l07-covariance.md" }).click();
    await expect(page.locator(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
    await expect(page.getByRole("region", { name: "Keys that work now" }).locator(".hint-desc").first()).toHaveText(
      "Ask about this line",
    );
    await expect(page.locator(".keys-notice")).toHaveText(longError.trim());

    if (process.env.LECTER_EVIDENCE_DIR)
      await page.screenshot({ path: `${process.env.LECTER_EVIDENCE_DIR}/document-column-${width}.png` });
    const b = await boxes(page);
    // The column's track: from the rail's right edge to the side panel's left edge.
    const track = b.side[0] - b.rail[1];
    // The case this guards: the notice is wider than the track at both widths, and at 960 px the
    // hint bar's keys are too (otherwise the check below would pass for any layout).
    expect(b.noticeMaxContent).toBeGreaterThan(track);
    if (width === 960) expect(b.hintsMinContent).toBeGreaterThan(track);

    expect(b.column[0]).toBeCloseTo(b.rail[1], 0);
    expect(b.column[1]).toBeCloseTo(b.side[0], 0);
    for (const [name, edges] of [
      ["buffer", b.buffer],
      ["buffer scroller", b.scroller],
      ["hint bar", b.hints],
      ["status line", b.status],
    ] as const) {
      expect(edges[0], `${name} left edge`).toBeCloseTo(b.column[0], 0);
      expect(edges[1], `${name} right edge`).toBeCloseTo(b.column[1], 0);
    }
  });
}
