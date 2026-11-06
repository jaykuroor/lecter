// The OS accent colour on macOS and Windows, as the app reads it (F-044,
// crates/core/src/theme/accent.rs): macOS `defaults read -g AppleAccentColor` (unset is
// Multicolour, which keeps Lecter's accent), Windows HKCU …\Explorer\Accent AccentColorMenu, else
// DWM AccentColor, a REG_DWORD in 0xAABBGGRR order. Flows read it to know what the app should
// paint, and on CI pin it to a known value, restoring the old one after. A developer's own
// setting is never changed (callers pin only when `CI` is set).

import { spawnSync } from "node:child_process";

const ACCENT_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent";
const DWM_KEY = "HKCU\\Software\\Microsoft\\Windows\\DWM";
/** macOS's accents by AppleAccentColor value (NSColor.controlAccentColor). */
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

/** An accent a flow can pin: Lecter's own (#3584e4, so the app paints tokens.json's accent) or macOS Green. */
export type Pin = "lecter" | "green";
const PIN_HEX: Record<Pin, string> = { lecter: "#3584e4", green: "#62ba46" };
/** Each pin as the Windows REG_DWORD (0xAABBGGRR) and the macOS AppleAccentColor value (null: delete it). */
const PIN_WIN: Record<Pin, string> = { lecter: "0xffe48435", green: "0xff46ba62" };
const PIN_MAC: Record<Pin, string | null> = { lecter: null, green: "3" };

function sh(cmd: string, args: string[]): { status: number | null; out: string } {
  // A bounded wait: a tool that hangs must not hang the run.
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20_000 });
  return { status: r.error ? null : r.status, out: (r.stdout ?? "").trim() };
}

/** The colour a pin stands for, as `#rrggbb`. */
export function pinned(pin: Pin): string {
  return PIN_HEX[pin];
}

/** A `reg query` answer's REG_DWORD (`0xAABBGGRR`) as `#rrggbb`; null when there is none. */
function regAccent(key: string, name: string): string | null {
  const r = sh("reg", ["query", key, "/v", name]);
  const m = r.status === 0 ? /REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.out) : null;
  if (!m?.[1]) return null;
  const v = Number.parseInt(m[1], 16);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(v & 255)}${hex((v >> 8) & 255)}${hex((v >> 16) & 255)}`;
}

/** The accent the OS holds now, as the app reads it; null for none (Lecter's applies) or another OS. */
export function osAccent(): string | null {
  if (process.platform === "darwin") {
    const r = sh("defaults", ["read", "-g", "AppleAccentColor"]);
    return r.status === 0 ? (MAC_ACCENTS[r.out] ?? null) : null;
  }
  if (process.platform === "win32") {
    return regAccent(ACCENT_KEY, "AccentColorMenu") ?? regAccent(DWM_KEY, "AccentColor");
  }
  return null;
}

/**
 * Sets the OS accent to `pin` and returns how to put the old value back; null on other OSes.
 * Callers do this only on CI. `log` names the flow in the printed line.
 */
export function pinAccent(pin: Pin, log: string): (() => void) | null {
  if (process.platform === "darwin") {
    const before = sh("defaults", ["read", "-g", "AppleAccentColor"]);
    const value = PIN_MAC[pin];
    const r =
      value === null
        ? sh("defaults", ["delete", "-g", "AppleAccentColor"])
        : sh("defaults", ["write", "-g", "AppleAccentColor", "-int", value]);
    console.log(
      `${log}: macOS AppleAccentColor ${before.status === 0 ? before.out : "unset"} → ${value ?? "unset"} (${r.status}); reads ${osAccent() ?? "none"}`,
    );
    return () => {
      if (before.status === 0) sh("defaults", ["write", "-g", "AppleAccentColor", "-int", before.out]);
      else sh("defaults", ["delete", "-g", "AppleAccentColor"]);
    };
  }
  if (process.platform === "win32") {
    const before = sh("reg", ["query", ACCENT_KEY, "/v", "AccentColorMenu"]);
    const old = before.status === 0 ? /REG_DWORD\s+(0x[0-9a-f]+)/i.exec(before.out)?.[1] : undefined;
    const value = PIN_WIN[pin];
    const r = sh("reg", ["add", ACCENT_KEY, "/v", "AccentColorMenu", "/t", "REG_DWORD", "/d", value, "/f"]);
    console.log(
      `${log}: Windows AccentColorMenu ${old ?? "unset"} → ${value} (${r.status}); reads ${osAccent() ?? "none"}`,
    );
    return () => {
      if (old) sh("reg", ["add", ACCENT_KEY, "/v", "AccentColorMenu", "/t", "REG_DWORD", "/d", old, "/f"]);
      else sh("reg", ["delete", ACCENT_KEY, "/v", "AccentColorMenu", "/f"]);
    };
  }
  return null;
}
