import { describe, expect, it } from "vitest";
import { hasCommand, registerCommand, runCommand, watchCommands } from "./commands";

// The commands keys run: a feature registers a handler; the hint bar asks which commands have one
// and follows them coming and going (F-038).

describe("commands", () => {
  it("knows which commands have a handler, and tells a watcher each time one comes or goes", () => {
    let pings = 0;
    const unwatch = watchCommands(() => {
      pings++;
    });
    expect(hasCommand("test.cmd")).toBe(false);
    const drop = registerCommand("test.cmd", () => true);
    expect(hasCommand("test.cmd")).toBe(true);
    expect(pings).toBe(1);
    drop();
    expect(hasCommand("test.cmd")).toBe(false);
    expect(pings).toBe(2);
    // A stale drop (another handler took over) changes nothing and tells nobody.
    const second = registerCommand("test.cmd", () => true);
    drop();
    expect(hasCommand("test.cmd")).toBe(true);
    expect(pings).toBe(3);
    unwatch();
    second();
    expect(hasCommand("test.cmd")).toBe(false);
    expect(pings).toBe(3);
    expect(
      runCommand({ binding: { keys: "x", command: "test.cmd", scope: "line", desc: "" }, count: 1, explicit: false }),
    ).toBe(false);
  });
});
