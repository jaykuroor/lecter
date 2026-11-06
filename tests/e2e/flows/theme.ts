// F-042 criterion 3: with no GTK theme applying, the app follows the OS dark/light preference
// (12-settings-theme-onboarding.md#theme) with the bundled Lecter theme's values from
// docs/design/tokens.json. The flow sets the OS preference the way each OS hands it to a new app,
// relaunches the app (relaunch.ts) and reads what the webview resolved:
//
// - Linux: GTK_THEME=Adwaita[:dark], which WebKitGTK reads for prefers-color-scheme. The session
//   bus points nowhere, so the desktop's own colour scheme (the settings portal, which tao applies
//   at window creation) can't override the run's choice on a developer's desktop.
// - macOS: `-AppleInterfaceStyle Dark|Light` on the command line, the per-app form of the system
//   appearance default (NSArgumentDomain), which AppKit and WKWebView follow.
// - Windows: HKCU …\Themes\Personalize AppsUseLightTheme, the setting Settings → Colours writes;
//   tao reads it when the window opens and hands it to WebView2. The flow restores it after.
//
// Then it opens a synthetic lecture, opens a gloss prompt (a) and saves theme-light.png / theme-dark.png.
// The live switch (an OS change while the app runs) is the page's prefers-color-scheme media query;
// ui/e2e/theme.spec.ts drives it in the mocked page.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Relaunch, relaunch, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

type Scheme = "light" | "dark";
type Pair = Record<Scheme, string>;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tokens = JSON.parse(readFileSync(join(root, "docs", "design", "tokens.json"), "utf8")) as Record<
  string,
  Record<string, Pair>
>;
const COLOURS = Object.entries({ ...tokens.color, ...tokens["gloss-kind"] }).filter(([n]) => !n.startsWith("$"));

const NAME = "2026-10-27-l09-theme.md";
// A synthetic lecture as Lecter writes it (03-lecture-files.md), with a steps and a doubt gloss.
const LECTURE = [
  "---",
  "lecter: 1",
  "lecture: 9",
  "date: 2026-10-27",
  "title: Variance of a sum",
  "---",
  "",
  '::: {.slide #s1 n=1 title="Variance of a sum"}',
  "## Variance of a sum",
  "",
  "[The variance of a sum adds twice the covariance of its terms.]{#s1b1}",
  "",
  "::: {.gloss #g-1a2b kind=steps key=s anchor=s1b1 by=ai}",
  "**you asked:** where does the covariance term come from?",
  "",
  "Expand the square of the centred sum; the cross terms average to twice the covariance.",
  ":::",
  "",
  "[Independent terms have zero covariance, so their variances simply add.]{#s1b2}",
  "",
  "::: {.gloss #g-3c4d kind=doubt key=D anchor=s1b2 by=ai status=open}",
  "**you asked:** does zero covariance mean independent?",
  "",
  "No: zero covariance rules out only a linear relation.",
  ":::",
  "",
  ":::",
  "",
].join("\n");

function course(): string {
  const dir = process.env.LECTER_TEST_PICK;
  if (!dir) throw new Error("LECTER_TEST_PICK is not set: run flows through scripts/e2e-app.sh");
  return dir;
}

// Windows: the apps' light/dark switch, and what it held before the flow.
const PERSONALIZE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
let savedWindowsValue: string | null | undefined;

function readAppsUseLightTheme(): string | null {
  try {
    const out = execFileSync("reg", ["query", PERSONALIZE, "/v", "AppsUseLightTheme"], { encoding: "utf8" });
    return /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

function writeAppsUseLightTheme(value: string): void {
  execFileSync("reg", ["add", PERSONALIZE, "/v", "AppsUseLightTheme", "/t", "REG_DWORD", "/d", value, "/f"]);
}

/** How to start the app so the OS hands it `scheme`. */
function launchIn(scheme: Scheme): Relaunch {
  const how: Relaunch = { log: `theme-${scheme}` };
  if (process.platform === "linux") {
    how.env = {
      GTK_THEME: scheme === "dark" ? "Adwaita:dark" : "Adwaita",
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(tmpdir(), "lecter-e2e-no-session-bus")}`,
      NO_AT_BRIDGE: "1",
    };
  } else if (process.platform === "darwin") {
    how.args = ["-AppleInterfaceStyle", scheme === "dark" ? "Dark" : "Light"];
  } else if (process.platform === "win32") {
    how.whileClosed = () => {
      if (savedWindowsValue === undefined) savedWindowsValue = readAppsUseLightTheme();
      writeAppsUseLightTheme(scheme === "dark" ? "0" : "1");
    };
  }
  return how;
}

/** `#rrggbb` as getComputedStyle prints a colour. */
function rgb(hex: string): string {
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

/** What the webview resolved, in one call: its colour scheme, every token, two painted colours. */
function resolved(
  names: string[],
): Promise<{ dark: boolean; tokens: Record<string, string>; frame: string; text: string }> {
  return browser.execute((list: string[]) => {
    const style = getComputedStyle(document.documentElement);
    const frame = document.querySelector(".app-frame");
    return {
      dark: matchMedia("(prefers-color-scheme: dark)").matches,
      tokens: Object.fromEntries(list.map((n) => [n, style.getPropertyValue(`--${n}`).trim()])),
      frame: frame ? getComputedStyle(frame).backgroundColor : "",
      text: frame ? getComputedStyle(frame).color : "",
    };
  }, names);
}

describe("theme", () => {
  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(join(course(), "lectures", NAME), LECTURE);
  });

  after(async () => {
    await stopRelaunched();
    if (process.platform === "win32" && savedWindowsValue !== undefined) {
      if (savedWindowsValue === null) {
        execFileSync("reg", ["delete", PERSONALIZE, "/v", "AppsUseLightTheme", "/f"]);
      } else {
        writeAppsUseLightTheme(String(Number.parseInt(savedWindowsValue, 16)));
      }
    }
    // Other flows list this course's lectures exactly.
    rmSync(join(course(), "lectures", NAME), { force: true });
  });

  for (const scheme of ["light", "dark"] as const) {
    it(`follows the OS ${scheme} preference with the Lecter theme`, async () => {
      await relaunch(launchIn(scheme));
      await expect($(".app-frame")).toBeDisplayed();
      const got = await resolved(COLOURS.map(([name]) => name));
      expect(got.dark).toBe(scheme === "dark");
      expect(got.tokens).toEqual(Object.fromEntries(COLOURS.map(([name, v]) => [name, v[scheme]])));
      expect(got.frame).toBe(rgb(tokens.color?.["window-bg"]?.[scheme] ?? ""));
      expect(got.text).toBe(rgb(tokens.color?.["window-fg"]?.[scheme] ?? ""));

      // The course and the lecture, by mouse (the folder dialog answers LECTER_TEST_PICK).
      await $("button.rail-add").click();
      await $(`button.course-file-open[data-path="lectures/${NAME}"]`).click();
      await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
      // A gloss card in its kind's colour: `a` opens the prompt under the first block.
      await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
      await browser.keys("a");
      await expect($(".gloss-prompt-input")).toBeExisting();
      await shot(`theme-${scheme}`);
    });
  }
});
