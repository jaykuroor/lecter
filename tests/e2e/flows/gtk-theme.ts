// F-043: on Linux the app follows the desktop's GTK theme live (12-settings-theme-onboarding.md#theme).
// The flow relaunches the app with LECTER_TEST_GTK pointing at a folder of its own: the synthetic
// fixture themes (tests/fixtures/gtk-themes) as its only theme folder, and a fake `gdbus` that
// answers the portal's ReadAll with the theme `Greyish` and, as `gdbus monitor`, prints whatever the
// flow writes into a FIFO, the way the portal's SettingChanged signal arrives. The app must paint
// Greyish's colours (and Lecter's for every name Greyish lacks), then switch to `Nightish` (dark)
// within a second of the signal. Saves gtk-theme.png and gtk-theme-live.png. On macOS and
// Windows the desktop's GTK settings aren't read, so the Lecter theme stays.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  cpSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { relaunch, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tokens = JSON.parse(readFileSync(join(root, "docs", "design", "tokens.json"), "utf8")) as {
  color: Record<string, { light: string; dark: string }>;
};
const DIR = join(tmpdir(), `lecter-e2e-gtk-${process.pid}`);
const FIFO = join(DIR, "portal.fifo");
const SIGNAL = "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged";
const READ_ALL = "({'org.gnome.desktop.interface': {'gtk-theme': <'Greyish'>}},)";

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** The fake desktop: fixture themes, a `gdbus` that answers ReadAll and relays the FIFO. */
function fakeDesktop(): void {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  cpSync(join(root, "tests", "fixtures", "gtk-themes"), join(DIR, "themes"), { recursive: true });
  if (process.platform === "win32") return;
  execFileSync("mkfifo", [FIFO]);
  const gdbus = join(DIR, "gdbus");
  const script = [
    "#!/bin/sh",
    `case "$1" in`,
    `  call) echo "${READ_ALL}" ;;`,
    `  monitor) exec cat '${FIFO}' ;;`,
    "  *) exit 2 ;;",
    "esac",
    "",
  ].join("\n");
  // Written and closed in one call: a script still open for writing can't be run (ETXTBSY), and
  // the app's spawn would give up on it, so no desktop would be read.
  writeFileSync(gdbus, script, { mode: 0o755 });
  chmodSync(gdbus, 0o755);
}

/** Each token as the colour it paints: a probe's computed `color: var(--token)`, inside an rgb(1, 2, 3) parent. */
function painted(names: string[]): Promise<{ scheme: string | null; tokens: Record<string, string> }> {
  return browser.execute((list: string[]) => {
    const parent = document.body.appendChild(document.createElement("div"));
    parent.style.color = "rgb(1, 2, 3)";
    const probe = parent.appendChild(document.createElement("span"));
    const out: Record<string, string> = {};
    for (const n of list) {
      probe.style.color = `var(--${n})`;
      out[n] = getComputedStyle(probe).color;
    }
    parent.remove();
    return { scheme: document.documentElement.dataset.theme ?? null, tokens: out };
  }, names);
}

/** What the core answers `theme_get` with right now, for a failure message. */
async function coreTheme(): Promise<string> {
  return await browser.execute(async () => {
    type Internals = { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
    try {
      return JSON.stringify(await internals.invoke("theme_get", {}));
    } catch (e) {
      return `theme_get failed: ${String(e)}`;
    }
  });
}

describe("gtk-theme", () => {
  before(fakeDesktop);

  after(async () => {
    // If the fake monitor's `cat` still waits on the FIFO, open and close it so `cat` ends.
    if (process.platform !== "win32") {
      try {
        closeSync(openSync(FIFO, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK));
      } catch {
        // No reader left: nothing waits on it.
      }
    }
    await stopRelaunched();
    rmSync(DIR, { recursive: true, force: true });
  });

  it("applies the desktop's GTK theme, then follows a change within a second", async () => {
    await relaunch({ log: "gtk-theme", env: { LECTER_TEST_GTK: DIR } });
    await expect($(".app-frame")).toBeDisplayed();
    const names = ["window-bg", "window-fg", "view-fg", "accent-bg", "headerbar-bg", "sidebar-bg"];
    if (process.platform !== "linux") {
      const got = await painted(names);
      // Not Linux: no desktop GTK settings are read; the Lecter theme paints every token.
      expect(got.tokens["headerbar-bg"]).not.toBe(rgb("#f7f7f7"));
      expect(got.tokens["window-bg"]).not.toBe(rgb("#f7f7f7"));
      await shot("gtk-theme-not-linux");
      return;
    }
    await browser
      .waitUntil(async () => (await painted(["window-bg"])).tokens["window-bg"] === rgb("#f7f7f7"), {
        timeout: 5000,
        timeoutMsg: "Greyish's window colour never painted",
      })
      .catch(async (e: Error) => {
        // Which side failed: the page's tokens, and what the core would answer now. The core's
        // `theme:` lines in gtk-theme.log say which source it read and which stylesheet it used.
        const page = JSON.stringify(await painted(["window-bg"]));
        throw new Error(`${e.message}; page ${page}; core ${await coreTheme()}; see the theme: lines in gtk-theme.log`);
      });
    const greyish = await painted(names);
    expect(greyish.scheme).toBe("light");
    expect(greyish.tokens).toEqual({
      "window-bg": rgb("#f7f7f7"),
      "window-fg": rgb("#323232"),
      "view-fg": rgb("#363636"),
      "accent-bg": rgb("#f0544c"),
      // Greyish defines no headerbar or sidebar colour: Lecter's light ones stay.
      "headerbar-bg": rgb(tokens.color["headerbar-bg"]?.light ?? ""),
      "sidebar-bg": rgb(tokens.color["sidebar-bg"]?.light ?? ""),
    });
    await shot("gtk-theme");

    // The page notes when the dark theme lands; the flow notes when it sends the signal.
    await browser.execute(() => {
      const w = window as unknown as { __gtkSwitched?: number };
      delete w.__gtkSwitched;
      new MutationObserver((_, observer) => {
        if (getComputedStyle(document.documentElement).getPropertyValue("--window-bg").trim() === "#1e1e1e") {
          w.__gtkSwitched = Date.now();
          observer.disconnect();
        }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });
    });
    // Non-blocking: with no monitor reading the FIFO this fails at once (ENXIO) instead of hanging.
    const fifo = openSync(FIFO, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK);
    const sent = Date.now();
    writeSync(fifo, `${SIGNAL} ('org.gnome.desktop.interface', 'gtk-theme', <'Nightish'>)\n`);
    await browser.waitUntil(
      async () => browser.execute(() => (window as unknown as { __gtkSwitched?: number }).__gtkSwitched !== undefined),
      { timeout: 1000, interval: 20, timeoutMsg: "the app didn't follow the theme change within a second" },
    );
    const switched = await browser.execute(() => (window as unknown as { __gtkSwitched?: number }).__gtkSwitched ?? 0);
    closeSync(fifo);
    console.log(`gtk-theme: signal → tokens applied in ${switched - sent} ms`);
    const night = await painted(names);
    expect(night.scheme).toBe("dark");
    expect(night.tokens["window-bg"]).toBe(rgb("#1e1e1e"));
    expect(night.tokens["window-fg"]).toBe(rgb("#ffffff"));
    // Nightish sets only its window colours: everything else is Lecter's dark theme.
    expect(night.tokens["headerbar-bg"]).toBe(rgb(tokens.color["headerbar-bg"]?.dark ?? ""));
    expect(night.tokens["accent-bg"]).toBe(rgb(tokens.color["accent-bg"]?.dark ?? ""));
    await shot("gtk-theme-live");
  });
});
