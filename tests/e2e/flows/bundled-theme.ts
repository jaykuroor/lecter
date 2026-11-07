// F-044: on macOS and Windows the app offers the bundled themes (Adwaita, Yaru, Breeze,
// Catppuccin, Gruvbox, Nord; light and dark) and any GTK theme folder in ~/.themes, and follows
// the OS accent colour (12-settings-theme-onboarding.md#theme).
//
// The flow relaunches the app with LECTER_TEST_GTK pointing at a folder of its own whose `themes`
// folder stands in for ~/.themes (it holds the synthetic fixture theme Greyish) and with no
// desktop tools, plus LECTER_TEST_BUNDLED=1 so a Linux run offers the bundled themes too. It
// checks theme_list, then chooses themes through `settings_set ui.theme` (as `:set` and Settings
// do) and reads the painted colours. Saves bundled-nord-dark.png and bundled-catppuccin-light.png.
//
// Accent (macOS and Windows): on CI the flow sets the OS accent before the launch (macOS
// `defaults write -g AppleAccentColor`, Windows HKCU …\Explorer\Accent AccentColorMenu) and puts
// the old value back after; elsewhere it leaves the user's setting alone and expects what the OS
// holds now. On Linux the accent comes from the desktop portal (F-043, gtk-theme.ts).

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { osAccent, pinAccent, pinned } from "../support/accent.ts";
import { invoke } from "../support/invoke.ts";
import { relaunch, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(tmpdir(), `lecter-e2e-bundled-${process.pid}`);
const THEMES = ["Adwaita", "Yaru", "Breeze", "Catppuccin", "Gruvbox", "Nord"];
const ON_CI = Boolean(process.env.CI);
/** Lecter's own accent (tokens.json accent-bg), when the OS sets none. */
const LECTER_ACCENT = pinned("lecter");
/** The accent CI pins: macOS Green (AppleAccentColor 3), and the same colour on Windows. */
const CI_ACCENT = pinned("green");

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Puts the OS accent back after a CI run; null when nothing was changed. */
let restoreAccent: (() => void) | null = null;

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

/** `:set ui.theme <name>` (null: unset), then waits until window-bg paints `windowBg`. */
async function choose(name: string | null, windowBg: string): Promise<void> {
  const value = JSON.stringify(name);
  const set = await invoke("settings_set", { key: "ui.theme", value, course: null, scope: "global" });
  await browser
    .waitUntil(async () => (await painted(["window-bg"])).tokens["window-bg"] === rgb(windowBg), {
      timeout: 5000,
      timeoutMsg: `${name}'s window colour ${windowBg} never painted`,
    })
    .catch(async (e: Error) => {
      const core = JSON.stringify(await invoke("theme_get", {}));
      throw new Error(`${e.message}; settings_set ${JSON.stringify(set)}; core ${core}; see bundled-theme.log`);
    });
}

describe("bundled-theme", () => {
  before(() => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(join(DIR, "themes"), { recursive: true });
    cpSync(join(root, "tests", "fixtures", "gtk-themes", "Greyish"), join(DIR, "themes", "Greyish"), {
      recursive: true,
    });
    if (ON_CI) restoreAccent = pinAccent("green", "bundled-theme");
  });

  after(async () => {
    // The flows share one home: leave ui.theme unset for the next flow.
    await invoke("settings_set", { key: "ui.theme", value: "null", course: null, scope: "global" }).catch(() => {});
    await stopRelaunched();
    restoreAccent?.();
    rmSync(DIR, { recursive: true, force: true });
  });

  it("offers the bundled themes and a ~/.themes folder, and applies the one chosen", async () => {
    await relaunch({ log: "bundled-theme", env: { LECTER_TEST_GTK: DIR, LECTER_TEST_BUNDLED: "1" } });
    await expect($(".app-frame")).toBeDisplayed();

    const list = (await invoke("theme_list", {})) as { name: string; folder: string }[];
    const bundled = list.filter((t) => t.folder === "").map((t) => t.name);
    const expected = THEMES.flatMap((t) => [t, `${t}-light`, `${t}-dark`]);
    expect([...bundled].sort()).toEqual([...expected].sort());
    expect(list.filter((t) => t.folder !== "")).toEqual([{ name: "Greyish", folder: join(DIR, "themes") }]);
    console.log(`bundled-theme: theme_list offers ${list.length} themes`);

    await choose("Nord-dark", "#3b4252");
    const nord = await painted(["view-bg", "window-fg", "k-derive", "k-prof"]);
    expect(nord).toEqual({
      scheme: "dark",
      tokens: {
        "view-bg": rgb("#2e3440"),
        "window-fg": rgb("#eceff4"),
        "k-derive": rgb("#81a1c1"),
        "k-prof": rgb("#bf616a"),
      },
    });
    await shot("bundled-nord-dark");

    await choose("Catppuccin-light", "#e6e9ef");
    const latte = await painted(["view-bg", "window-fg", "k-ask"]);
    expect(latte).toEqual({
      scheme: "light",
      tokens: { "view-bg": rgb("#eff1f5"), "window-fg": rgb("#4c4f69"), "k-ask": rgb("#40a02b") },
    });
    await shot("bundled-catppuccin-light");

    // The ~/.themes folder's theme applies like an installed GTK theme.
    await choose("Greyish", "#f7f7f7");
    expect((await painted(["window-fg"])).tokens["window-fg"]).toBe(rgb("#323232"));
  });

  it("follows the OS accent colour on macOS and Windows", async () => {
    if (process.platform === "linux") {
      console.log("bundled-theme: Linux takes its accent from the desktop portal (gtk-theme.ts)");
      return;
    }
    // Back to the Lecter theme, whose accent the OS's replaces.
    await invoke("settings_set", { key: "ui.theme", value: "null", course: null, scope: "global" });
    const want = ON_CI ? CI_ACCENT : (osAccent() ?? LECTER_ACCENT);
    console.log(`bundled-theme: ${process.platform} accent expected ${want} (OS reports ${osAccent() ?? "none"})`);
    await browser
      .waitUntil(async () => (await painted(["accent-bg"])).tokens["accent-bg"] === rgb(want), {
        timeout: 5000,
        timeoutMsg: `the OS accent ${want} never painted`,
      })
      .catch(async (e: Error) => {
        const page = JSON.stringify(await painted(["accent-bg"]));
        throw new Error(`${e.message}; page ${page}; core ${JSON.stringify(await invoke("theme_get", {}))}`);
      });
    const accent = await painted(["accent-bg", "window-bg"]);
    expect(accent.tokens["accent-bg"]).toBe(rgb(want));
    // Only the accent is the OS's: the surfaces stay the Lecter theme's.
    expect(accent.tokens["window-bg"]).not.toBe(rgb(want));
    await shot("bundled-os-accent");
  });
});
