import { describe, expect, it } from "vitest";
import { hasCommand, runCommand } from "../../keys/commands";
import type { SettingsContext, SettingsHandle } from "./mount";
import { registerSettings, SETTINGS_COMMAND } from "./register";

// Ctrl/Cmd-, runs `settings.open` (keys/keymap.ts): the window's chunk loads on the first open,
// once, and every open after it goes to the same window.

const ctx = {} as SettingsContext;
const press = () =>
  runCommand({
    binding: { keys: "<Mod-,>", command: SETTINGS_COMMAND, scope: "global", desc: "Settings" },
    count: 1,
    explicit: false,
  });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake of the window's chunk: how often it loaded and started, and what its window was asked. */
function fakeChunk() {
  const log: string[] = [];
  let release: () => void = () => {};
  const loaded = new Promise<void>((r) => {
    release = r;
  });
  const handle: SettingsHandle = {
    settings: {} as SettingsHandle["settings"],
    open: () => log.push("open"),
    stop: () => log.push("stop"),
  };
  const load = async () => {
    log.push("load");
    await loaded;
    return {
      startSettings: () => {
        log.push("start");
        return handle;
      },
    } as unknown as typeof import("./mount");
  };
  return { log, load, release: () => release() };
}

describe("registerSettings", () => {
  it("loads the window on the first open only, and opens it at each press", async () => {
    const chunk = fakeChunk();
    const drop = registerSettings(ctx, chunk.load);
    expect(hasCommand(SETTINGS_COMMAND)).toBe(true);
    expect(chunk.log).toEqual([]);
    expect(press()).toBe(true);
    press();
    chunk.release();
    await tick();
    expect(chunk.log).toEqual(["load", "start", "open", "open"]);
    press();
    await tick();
    expect(chunk.log).toEqual(["load", "start", "open", "open", "open"]);
    drop();
    await tick();
    expect(chunk.log.at(-1)).toBe("stop");
    expect(hasCommand(SETTINGS_COMMAND)).toBe(false);
  });

  it("starts no window when it is dropped while the chunk loads", async () => {
    const chunk = fakeChunk();
    const drop = registerSettings(ctx, chunk.load);
    press();
    drop();
    chunk.release();
    await tick();
    expect(chunk.log).toEqual(["load"]);
  });

  it("drops cleanly when it never opened", async () => {
    const chunk = fakeChunk();
    registerSettings(ctx, chunk.load)();
    await tick();
    expect(chunk.log).toEqual([]);
    expect(hasCommand(SETTINGS_COMMAND)).toBe(false);
  });
});
