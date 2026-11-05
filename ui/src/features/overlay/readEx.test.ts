import { describe, expect, it, vi } from "vitest";
import { registerReadCommand } from "./readEx";

// `:read` (10-keymap.md#commands) is read mode's Ex command in the lecture buffer, beside ␣ur.

/** A recording stand-in for Vim's Ex table. */
function fakeVim() {
  const defined: { name: string; prefix: string | undefined; fn: () => void }[] = [];
  return {
    defined,
    defineEx(name: string, prefix: string | undefined, fn: (...args: never[]) => unknown) {
      defined.push({ name, prefix, fn: fn as () => void });
    },
  };
}

describe(":read", () => {
  it("is defined once as `read`, with no shorter form, and runs the latest handler", () => {
    const vim = fakeVim();
    const first = vi.fn();
    const second = vi.fn();
    const dropFirst = registerReadCommand(first, vim);
    const dropSecond = registerReadCommand(second, vim);
    expect(vim.defined.map((d) => [d.name, d.prefix])).toEqual([["read", undefined]]);
    vim.defined[0]?.fn();
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1]);
    // Dropping a handler that is no longer the current one leaves the current one.
    dropFirst();
    vim.defined[0]?.fn();
    expect(second).toHaveBeenCalledTimes(2);
    dropSecond();
    vim.defined[0]?.fn();
    expect(second).toHaveBeenCalledTimes(2);
  });
});
