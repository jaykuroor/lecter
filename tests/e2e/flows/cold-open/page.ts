// In-page measurements of the cold-open flow (tests/e2e/flows/cold-open.ts). Everything timed runs
// inside the page in one `browser.execute`, never as a series of WebDriver commands, whose round
// trips are slow on the embedded server (tests/CLAUDE.md). Functions passed to `browser.execute`
// are serialised: they must be self-contained.

/** What the page measured, in ms on its own clock unless named otherwise. */
export interface PageTimes {
  /** The page's time origin, epoch ms (navigation start). */
  timeOrigin: number;
  /** The `startup:shell_first_paint` mark the UI leaves after its first paint, or null. */
  shellMark: number | null;
  /** The first contentful paint the engine reports, or null without paint timing. */
  fcp: number | null;
  /** Navigation timing: the document received, DOMContentLoaded done, the load event done. */
  responseEnd: number | null;
  domContentLoaded: number | null;
  loadEnd: number | null;
  /** Click on Open course folder → the lecture listed in the rail. */
  courseMs: number;
  /** Click on the lecture → its buffer's first line in the DOM. */
  lectureDomMs: number;
  /** Click on Open course folder → the frame showing the lecture's buffer has been painted. */
  openMs: number;
  /** Every resource the page loaded (resource timing): its URL's path and start time. */
  resources: { name: string; start: number }[];
}

/**
 * Waits for the shell's first-paint mark, clicks Open course folder (LECTER_TEST_PICK answers the
 * dialog), then the lecture `file`, and waits for the frame that shows its buffer. The user's two
 * clicks take no time: each click happens as soon as its button exists.
 */
export async function openInPage(file: string): Promise<PageTimes> {
  return await browser.execute(async (name: string) => {
    function until<T>(get: () => T | null | undefined, what: string, ms = 20_000): Promise<T> {
      return new Promise((resolve, reject) => {
        const now = get();
        if (now) return resolve(now);
        const timer = setTimeout(() => {
          obs.disconnect();
          reject(new Error(`timed out waiting for ${what}`));
        }, ms);
        const obs = new MutationObserver(() => {
          const v = get();
          if (!v) return;
          obs.disconnect();
          clearTimeout(timer);
          resolve(v);
        });
        obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      });
    }
    function painted(): Promise<void> {
      return new Promise((resolve) =>
        requestAnimationFrame(() => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => {
            ch.port1.close();
            resolve();
          };
          ch.port2.postMessage(0);
        }),
      );
    }
    const mark = () => performance.getEntriesByName("startup:shell_first_paint", "mark")[0]?.startTime ?? null;
    await until(() => mark() !== null || null, "the shell's first paint mark", 5_000).catch(() => undefined);

    const open = await until(
      () => document.querySelector<HTMLButtonElement>("button.course-open"),
      "Open course folder",
    );
    const t0 = performance.now();
    open.click();
    const row = await until(
      () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>("button.course-file-open")).find(
          (b) => b.textContent?.trim() === name,
        ),
      `${name} in the rail`,
    );
    const t1 = performance.now();
    row.click();
    await until(
      () => document.querySelector(`.lecture-buffer[data-lecture="lectures/${name}"] .cm-line`),
      "the lecture's buffer",
    );
    const t2 = performance.now();
    await painted();
    const t3 = performance.now();

    const path = (url: string) => new URL(url, location.href).pathname;
    const resources = performance.getEntriesByType("resource").map((r) => ({ name: path(r.name), start: r.startTime }));
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      timeOrigin: performance.timeOrigin,
      shellMark: mark(),
      fcp: fcp ? fcp.startTime : null,
      responseEnd: nav ? nav.responseEnd : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      loadEnd: nav ? nav.loadEventEnd : null,
      courseMs: t1 - t0,
      lectureDomMs: t2 - t1,
      openMs: t3 - t0,
      resources,
    };
  }, file);
}
