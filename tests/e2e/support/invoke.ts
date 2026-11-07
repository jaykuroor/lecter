// Calls a core command from a real-app flow as the UI does, through Tauri's IPC in the page. The
// command and its arguments are typed by the generated contract (ui/src/core/bindings.ts,
// 18-contracts.md#ipc), so a flow that misses an argument a command gained fails to type-check
// (ui/src/core/flows-contract.test.ts) instead of failing on CI's real app.
import type { CommandName, Commands } from "../../../ui/src/core/bindings";

/** `cmd`'s answer, or `{ error }` with the core's error as JSON text. */
export function invoke<K extends CommandName>(
  cmd: K,
  args: Commands[K]["args"],
): Promise<Commands[K]["result"] | { error: string }> {
  const answer = browser.execute(
    async (c: string, a: unknown) => {
      type Internals = { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
      try {
        return await internals.invoke(c, a);
      } catch (e) {
        return { error: String(JSON.stringify(e)) };
      }
    },
    cmd as string,
    args as unknown,
  );
  return answer as unknown as Promise<Commands[K]["result"] | { error: string }>;
}
