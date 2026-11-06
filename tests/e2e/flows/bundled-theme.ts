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

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { relaunch, stopRelaunched } from "../support/relaunch.ts";
import { shot } from "../support/shot.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(tmpdir(), `lecter-e2e-bundled-${process.pid}`);
const THEMES = ["Adwaita", "Yaru", "Breeze", "Catppuccin", "Gruvbox", "Nord"];
const ON_CI = Boolean(process.env.CI);
/** Lecter's own accent (tokens.json accent-bg), when the OS sets none. */
const LECTER_ACCENT = "#3584e4";
/** The accent CI sets: macOS Green (AppleAccentColor 3), and the same colour on Windows. */
const CI_ACCENT = "#62ba46";
const MAC_ACCENTS: Record<string, string> = {
  "-1": "#989898",
  "0": "#e0383e",
  "1": "#f7821b",
  "2": "#ffc726",
  "3": "#62ba46",
  "4": "#007aff",
  "5": "#953d96",
  "6": "#f74f9e",
};
const WIN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent";
const WIN_DWM = "HKCU\\Software\\Microsoft\\Windows\\DWM";

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function sh(cmd: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20_000 });
  return { status: r.error ? null : r.status, out: (r.stdout ?? "").trim() };
}

/** A `reg query` answer's REG_DWORD, `0xAABBGGRR`, as `#rrggbb`; null when there is none. */
function regAccent(key: string, name: string): string | null {
  const r = sh("reg", ["query", key, "/v", name]);
  const m = r.status === 0 ? /REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.out) : null;
  if (!m?.[1]) return null;
  const v = Number.parseInt(m[1], 16);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(v & 255)}${hex((v >> 8) & 255)}${hex((v >> 16) & 255)}`;
}

/** The accent the OS holds now, as the app should read it; null for none. */
function osAccent(): string | null {
  if (process.platform === "darwin") {
    const r = sh("defaults", ["read", "-g", "AppleAccentColor"]);
    return r.status === 0 ? (MAC_ACCENTS[r.out] ?? null) : null;
  }
  if (process.platform === "win32") return regAccent(WIN_KEY, "AccentColorMenu") ?? regAccent(WIN_DWM, "AccentColor");
  return null;
}

/** Puts the OS accent back after a CI run; null when nothing was changed. */
let restoreAccent: (() => void) | null = null;

/** On CI, sets the OS accent to CI_ACCENT and remembers how to undo it. */
function setCiAccent(): void {
  if (!ON_CI) return;
  if (process.platform === "darwin") {
    const before = sh("defaults", ["read", "-g", "AppleAccentColor"]);
    const r = sh("defaults", ["write", "-g", "AppleAccentColor", "-int", "3"]);
    console.log(
      `bundled-theme: macOS AppleAccentColor ${before.status === 0 ? before.out : "unset"} → 3 (${r.status})`,
    );
    restoreAccent = () => {
      if (before.status === 0) sh("defaults", ["write", "-g", "AppleAccentColor", "-int", before.out]);
      else sh("defaults", ["delete", "-g", "AppleAccentColor"]);
    };
  } else if (process.platform === "win32") {
    const before = sh("reg", ["query", WIN_KEY, "/v", "AccentColorMenu"]);
    const old = /REG_DWORD\s+(0x[0-9a-f]+)/i.exec(before.out)?.[1];
    // #62ba46 as 0xAABBGGRR.
    const r = sh("reg", ["add", WIN_KEY, "/v", "AccentColorMenu", "/t", "REG_DWORD", "/d", "0xff46ba62", "/f"]);
    console.log(`bundled-theme: Windows AccentColorMenu ${old ?? "unset"} → 0xff46ba62 (${r.status})`);
    restoreAccent = () => {
      if (old) sh("reg", ["add", WIN_KEY, "/v", "AccentColorMenu", "/t", "REG_DWORD", "/d", old, "/f"]);
      else sh("reg", ["delete", WIN_KEY, "/v", "AccentColorMenu", "/f"]);
    };
  }
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

/** Calls a core command as the UI does; resolves to its answer, or `{ error }`. */
function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return browser.execute(
    async (c: string, a: Record<string, unknown>) => {
      type Internals = { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
      try {
        return await internals.invoke(c, a);
      } catch (e) {
        return { error: String(JSON.stringify(e)) };
      }
    },
    cmd,
    args,
  );
}

/** `:set ui.theme <name>` (null: unset), then waits until window-bg paints `windowBg`. */
async function choose(name: string | null, windowBg: string): Promise<void> {
  const set = await invoke("settings_set", { key: "ui.theme", value: JSON.stringify(name), course: null });
  await browser
    .waitUntil(async () => (await painted(["window-bg"])).tokens["window-bg"] === rgb(windowBg), {
      timeout: 5000,
      timeoutMsg: `${name}'s window colour ${windowBg} never painted`,
    })
    .catch(async (e: Error) => {
      const core = JSON.stringify(await invoke("theme_get"));
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
    setCiAccent();
  });

  after(async () => {
    // The flows share one home: leave ui.theme unset for the next flow.
    await invoke("settings_set", { key: "ui.theme", value: "null", course: null }).catch(() => {});
    await stopRelaunched();
    restoreAccent?.();
    rmSync(DIR, { recursive: true, force: true });
  });

  it("offers the bundled themes and a ~/.themes folder, and applies the one chosen", async () => {
    await relaunch({ log: "bundled-theme", env: { LECTER_TEST_GTK: DIR, LECTER_TEST_BUNDLED: "1" } });
    await expect($(".app-frame")).toBeDisplayed();

    const list = (await invoke("theme_list")) as { name: string; folder: string }[];
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
    await invoke("settings_set", { key: "ui.theme", value: "null", course: null });
    const want = ON_CI ? CI_ACCENT : (osAccent() ?? LECTER_ACCENT);
    console.log(`bundled-theme: ${process.platform} accent expected ${want} (OS reports ${osAccent() ?? "none"})`);
    await browser
      .waitUntil(async () => (await painted(["accent-bg"])).tokens["accent-bg"] === rgb(want), {
        timeout: 5000,
        timeoutMsg: `the OS accent ${want} never painted`,
      })
      .catch(async (e: Error) => {
        const page = JSON.stringify(await painted(["accent-bg"]));
        throw new Error(`${e.message}; page ${page}; core ${JSON.stringify(await invoke("theme_get"))}`);
      });
    const accent = await painted(["accent-bg", "window-bg"]);
    expect(accent.tokens["accent-bg"]).toBe(rgb(want));
    // Only the accent is the OS's: the surfaces stay the Lecter theme's.
    expect(accent.tokens["window-bg"]).not.toBe(rgb(want));
    await shot("bundled-os-accent");
  });
});
