// The status line's job spinner and active model (09-ui.md#layout) follow the answers the buffer
// asks for: a job runs from the ask until its stream ends (`done`, `stopped` or `failed`, exactly
// one of them, 18-contracts.md#ipc) or the core refuses it, and the model is the one the core
// names when a stream starts. Loaded with the editor's chunk.
import type { GlossBackend, GlossEvent } from "../../core/gloss";

/** Where jobs are counted and the model named (the status line's state). */
export interface JobSink {
  /** A job started; the function returned ends it (once, however often it is called). */
  begin(): () => void;
  /** The model a stream started on. */
  model(name: string): void;
}

/** `backend`, with each ask counted in `jobs` while it runs. */
export function trackJobs(backend: GlossBackend, jobs: JobSink): GlossBackend {
  return {
    request(block, question, onEvent) {
      const end = jobs.begin();
      const relay = (event: GlossEvent) => {
        if (event.event === "started") jobs.model(event.data.model);
        else if (event.event !== "delta") end();
        onEvent(event);
      };
      return backend.request(block, question, relay).then(
        (started) => {
          if (!started.ok) end();
          return started;
        },
        (error: unknown) => {
          end();
          throw error;
        },
      );
    },
    cancel: (gloss) => backend.cancel(gloss),
  };
}
