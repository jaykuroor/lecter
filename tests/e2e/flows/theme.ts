// F-042 criterion 3: with no GTK theme applying, the app follows the OS dark/light preference
// (12-settings-theme-onboarding.md#theme) with the bundled Lecter theme's values from
// docs/design/tokens.json. The flow sets the OS preference the way each OS hands it to a new app,
// relaunches the app (relaunch.ts) and reads what the webview resolved:
//
// - Linux: GTK_THEME=Adwaita[:dark], which WebKitGTK reads for prefers-color-scheme. The session
//   bus points nowhere, so the desktop's own colour scheme (the settings portal, which tao applies
//   at window creation) can't override the run's choice on a developer's desktop.
// - macOS: the global AppleInterfaceStyle default (System Settings → Appearance).
// - Windows: HKCU …\Themes\Personalize AppsUseLightTheme (Settings → Colours).
// These two are the user's own settings, so the flow changes them only on CI (`CI` set) and puts
// them back in `after` (and on exit). Elsewhere it leaves them alone and checks that the app
// follows the scheme they hold now. Each test logs the lever and the webview's matchMedia result.
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
// A synthetic lecture in Lecter's format (03-lecture-files.md), with a steps and a doubt gloss.
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

/** `#rrggbb` as getComputedStyle prints a colour. */
function rgb(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`tokens.json colour "${hex}" is not #rrggbb`);
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

/**
 * A per-user OS setting that holds the light/dark preference. The flow changes it only on CI
 * (`CI` set): never on a developer's machine. `null` means the setting is absent (light).
 */
interface OsSetting {
  /** For the log: where the preference lives. */
  name: string;
  read(): string | null;
  write(value: string | null): void;
  valueFor(scheme: Scheme): string | null;
  schemeOf(value: string | null): Scheme;
}

const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const tryRun = (cmd: string, args: string[]): string | null => {
  try {
    return run(cmd, args);
  } catch {
    return null;
  }
};

// macOS: the global AppleInterfaceStyle default, which System Settings → Appearance writes ("Dark",
// or absent for light). AppKit reads it when an app starts; tao leaves NSApp's appearance unset,
// so the window and WKWebView follow it. (The per-process `-AppleInterfaceStyle` argument did not
// reach WKWebView's prefers-color-scheme on CI.)
const MAC: OsSetting = {
  name: "defaults -g AppleInterfaceStyle",
  read: () => tryRun("defaults", ["read", "-g", "AppleInterfaceStyle"])?.trim() ?? null,
  write: (v) => {
    if (v === null) tryRun("defaults", ["delete", "-g", "AppleInterfaceStyle"]);
    else run("defaults", ["write", "-g", "AppleInterfaceStyle", v]);
  },
  valueFor: (s) => (s === "dark" ? "Dark" : null),
  schemeOf: (v) => (v === "Dark" ? "dark" : "light"),
};

// Windows: HKCU …\Themes\Personalize AppsUseLightTheme (0 dark, 1 or absent light), which
// Settings → Colours writes; tao reads it when the window opens and hands it to WebView2.
const PERSONALIZE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const WINDOWS: OsSetting = {
  name: "HKCU Personalize AppsUseLightTheme",
  read: () => {
    const hex = /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(
      tryRun("reg", ["query", PERSONALIZE, "/v", "AppsUseLightTheme"]) ?? "",
    )?.[1];
    return hex === undefined ? null : String(Number.parseInt(hex, 16));
  },
  write: (v) => {
    if (v === null) tryRun("reg", ["delete", PERSONALIZE, "/v", "AppsUseLightTheme", "/f"]);
    else run("reg", ["add", PERSONALIZE, "/v", "AppsUseLightTheme", "/t", "REG_DWORD", "/d", v, "/f"]);
  },
  valueFor: (s) => (s === "dark" ? "0" : "1"),
  schemeOf: (v) => (v === "0" ? "dark" : "light"),
};

const setting: OsSetting | null = process.platform === "darwin" ? MAC : process.platform === "win32" ? WINDOWS : null;
// Linux sets the preference for the relaunched app alone (environment), so it runs anywhere.
const canSwitch = setting === null || Boolean(process.env.CI);
const LINUX_NO_BUS = `unix:path=${join(tmpdir(), "lecter-e2e-no-session-bus")}`;

/** The OS setting's value before the flow changed anything; `undefined` while untouched. */
let saved: string | null | undefined;

function putBack(): void {
  if (setting === null || saved === undefined) return;
  setting.write(saved);
  saved = undefined;
}

/** How to start the app so the OS hands it `scheme`; `null` leaves the OS as it is. */
function launchIn(scheme: Scheme | null): Relaunch {
  const how: Relaunch = { log: `theme-${scheme ?? "current"}` };
  if (scheme === null) return how;
  if (setting === null) {
    how.env = {
      GTK_THEME: scheme === "dark" ? "Adwaita:dark" : "Adwaita",
      DBUS_SESSION_BUS_ADDRESS: LINUX_NO_BUS,
      NO_AT_BRIDGE: "1",
    };
  } else {
    const os = setting;
    how.whileClosed = () => {
      if (saved === undefined) saved = os.read();
      os.write(os.valueFor(scheme));
    };
  }
  return how;
}

/** For the log (the CI evidence): the OS lever as the app saw it. */
function lever(launch: Relaunch): string {
  if (setting === null) return `GTK_THEME=${launch.env?.GTK_THEME ?? "(unset)"}`;
  const auto =
    process.platform === "darwin"
      ? tryRun("defaults", ["read", "-g", "AppleInterfaceStyleSwitchesAutomatically"])
      : null;
  return `${setting.name} = ${setting.read() ?? "(unset)"}${auto === null ? "" : `, switches automatically = ${auto.trim()}`}`;
}

/**
 * What the webview resolved, in one call: its colour scheme, every token as the colour it paints
 * (a probe element's computed `color: var(--token)`), and the frame's two colours. Resolved
 * colours, not the properties' text: the release CSS is minified (`#ffffff` → `#fff`). The probe
 * sits in a parent painted rgb(1, 2, 3), so a missing token (which would inherit) can't match.
 */
function resolved(
  names: string[],
): Promise<{ dark: boolean; tokens: Record<string, string>; frame: string; text: string }> {
  return browser.execute((list: string[]) => {
    const parent = document.body.appendChild(document.createElement("div"));
    parent.style.color = "rgb(1, 2, 3)";
    const probe = parent.appendChild(document.createElement("span"));
    const paint = (n: string) => {
      probe.style.color = `var(--${n})`;
      return getComputedStyle(probe).color;
    };
    const tokens = Object.fromEntries(list.map((n) => [n, paint(n)]));
    parent.remove();
    const frame = document.querySelector(".app-frame");
    return {
      dark: matchMedia("(prefers-color-scheme: dark)").matches,
      tokens,
      frame: frame ? getComputedStyle(frame).backgroundColor : "",
      text: frame ? getComputedStyle(frame).color : "",
    };
  }, names);
}

/** Opens the course and the lecture by mouse, then a gloss prompt (`a`), whose card shows its kind's colour. */
async function openGlossPrompt(): Promise<void> {
  // The folder dialog answers LECTER_TEST_PICK.
  await $("button.rail-add").click();
  await $(`button.course-file-open[data-path="lectures/${NAME}"]`).click();
  await expect($(".lecture-buffer")).toHaveAttribute("data-lecture", `lectures/${NAME}`);
  await expect($(".lecture-buffer")).toHaveAttribute("data-vim-mode", "normal");
  await browser.keys("a");
  await expect($(".gloss-prompt-input")).toBeExisting();
}

/**
 * The schemes to check, each with the OS preference to set first: both on CI (and on Linux, where
 * only the relaunched app sees the change); elsewhere only the one the OS holds now, unchanged.
 */
function cases(): { scheme: Scheme; set: Scheme | null }[] {
  if (canSwitch)
    return [
      { scheme: "light", set: "light" },
      { scheme: "dark", set: "dark" },
    ];
  const current = setting?.schemeOf(setting.read()) ?? "light";
  console.log(`theme: CI is not set, so ${setting?.name} is left as is; checking the current ${current} preference`);
  return [{ scheme: current, set: null }];
}

describe("theme", () => {
  before(() => {
    mkdirSync(join(course(), "lectures"), { recursive: true });
    writeFileSync(join(course(), "lectures", NAME), LECTURE);
    // A crash between a test and `after` must not leave the OS switched either.
    process.once("exit", putBack);
  });

  after(async () => {
    putBack();
    await stopRelaunched();
    // Other flows list this course's lectures exactly.
    rmSync(join(course(), "lectures", NAME), { force: true });
  });

  for (const { scheme, set } of cases()) {
    it(`follows the OS ${scheme} preference with the Lecter theme`, async () => {
      const launch = launchIn(set);
      await relaunch(launch);
      await expect($(".app-frame")).toBeDisplayed();
      const got = await resolved(COLOURS.map(([name]) => name));
      console.log(`theme: want ${scheme}; ${lever(launch)}; webview prefers-color-scheme: dark = ${got.dark}`);
      expect(got.dark).toBe(scheme === "dark");
      expect(got.tokens).toEqual(Object.fromEntries(COLOURS.map(([name, v]) => [name, rgb(v[scheme])])));
      expect(got.frame).toBe(rgb(tokens.color?.["window-bg"]?.[scheme] ?? ""));
      expect(got.text).toBe(rgb(tokens.color?.["window-fg"]?.[scheme] ?? ""));
      await openGlossPrompt();
      await shot(`theme-${scheme}`);
    });
  }
});
