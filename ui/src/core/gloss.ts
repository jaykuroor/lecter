import { Channel } from "@tauri-apps/api/core";
import { commands, type GlossStream_Deserialize } from "./bindings";

/** One event of a gloss's answer stream (`GlossStream`), as the UI receives it. */
export type GlossEvent = GlossStream_Deserialize;

/** What starting a gloss came to: its id, or the core's error message. */
type GlossStart = { ok: true; gloss: string } | { ok: false; message: string };

/** Asking about blocks of one open lecture: what the buffer's gloss feature calls. */
export interface GlossBackend {
  /** Asks `question` about block `block`; every event of the answer goes to `onEvent`, in order. */
  request(block: string, question: string, onEvent: (event: GlossEvent) => void): Promise<GlossStart>;
  /** Stops gloss `gloss`'s stream (`Esc`); its channel then gets `stopped`. Never awaited. */
  cancel(gloss: string): void;
}

/**
 * The backend for the open lecture `path` of `course` (`gloss_request`, `gloss_cancel` over the
 * `GlossStream` channel, 18-contracts.md#ipc). The core checks every argument (SEC-32).
 */
export function glossBackend(course: string, path: string): GlossBackend {
  return {
    async request(block, question, onEvent) {
      const channel = new Channel<GlossEvent>(onEvent);
      try {
        const result = await commands.glossRequest(course, path, block, question, channel);
        return result.status === "ok" ? { ok: true, gloss: result.data } : { ok: false, message: result.error.message };
      } catch {
        return { ok: false, message: "Lecter could not reach the core to ask." };
      }
    },
    cancel(gloss) {
      void commands.glossCancel(gloss).catch(() => undefined);
    },
  };
}
