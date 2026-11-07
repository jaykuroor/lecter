import { describe, expect, it } from "vitest";
import type { GlossBackend, GlossEvent } from "../../core/gloss";
import { type JobSink, trackJobs } from "./jobs";

// 09-ui.md#layout: the status line's job spinner turns while an answer streams, and the active
// model is the one the core names when a stream starts (GlossStream `started`).

/** A backend whose request returns `start` and hands its event listener to the test. */
function fakeBackend(start: Awaited<ReturnType<GlossBackend["request"]>> | Error) {
  const listeners: ((e: GlossEvent) => void)[] = [];
  const cancelled: string[] = [];
  const backend: GlossBackend = {
    request: (_block, _question, onEvent) => {
      listeners.push(onEvent);
      return start instanceof Error ? Promise.reject(start) : Promise.resolve(start);
    },
    cancel: (gloss) => cancelled.push(gloss),
  };
  return { backend, listeners, cancelled };
}

/** A sink that counts running jobs and keeps the models named. */
function sink() {
  const s = { running: 0, models: [] as string[] };
  const jobs: JobSink = {
    begin: () => {
      s.running++;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        s.running--;
      };
    },
    model: (m) => s.models.push(m),
  };
  return { s, jobs };
}

const started: GlossEvent = { event: "started", data: { gloss: "g-0001", model: "sample" } };

describe("trackJobs", () => {
  it("runs a job from the ask until its stream is done, and names its model", async () => {
    const { backend, listeners } = fakeBackend({ ok: true, gloss: "g-0001" });
    const { s, jobs } = sink();
    const seen: GlossEvent[] = [];
    const answer = trackJobs(backend, jobs).request("s1b1", "why?", (e) => seen.push(e));
    expect(s.running).toBe(1);
    expect(await answer).toEqual({ ok: true, gloss: "g-0001" });
    const send = listeners[0] as (e: GlossEvent) => void;
    send(started);
    expect(s.models).toEqual(["sample"]);
    send({ event: "delta", data: { text: "Because" } });
    expect(s.running).toBe(1);
    send({ event: "done", data: { markdown: "::: {.gloss}\n:::" } });
    expect(s.running).toBe(0);
    // Every event still reaches the card, in order.
    expect(seen.map((e) => e.event)).toEqual(["started", "delta", "done"]);
  });

  it.each([
    { event: "stopped", data: { markdown: null } },
    { event: "failed", data: { error: { code: "E_PROVIDER", message: "down", retryable: true, detail: null } } },
  ] as GlossEvent[])("ends the job when the stream ends with $event", async (end) => {
    const { backend, listeners } = fakeBackend({ ok: true, gloss: "g-0001" });
    const { s, jobs } = sink();
    await trackJobs(backend, jobs).request("s1b1", "why?", () => {});
    (listeners[0] as (e: GlossEvent) => void)(end);
    expect(s.running).toBe(0);
    expect(s.models).toEqual([]);
  });

  it("ends the job when the core refuses the ask", async () => {
    const { backend } = fakeBackend({ ok: false, message: "not trusted" });
    const { s, jobs } = sink();
    expect(await trackJobs(backend, jobs).request("s1b1", "why?", () => {})).toEqual({
      ok: false,
      message: "not trusted",
    });
    expect(s.running).toBe(0);
  });

  it("ends the job when the ask throws, and passes the error on", async () => {
    const { backend } = fakeBackend(new Error("gone"));
    const { s, jobs } = sink();
    await expect(trackJobs(backend, jobs).request("s1b1", "why?", () => {})).rejects.toThrow("gone");
    expect(s.running).toBe(0);
  });

  it("counts two answers streaming at once", async () => {
    const { backend, listeners } = fakeBackend({ ok: true, gloss: "g-0001" });
    const { s, jobs } = sink();
    const tracked = trackJobs(backend, jobs);
    await tracked.request("s1b1", "one", () => {});
    await tracked.request("s1b2", "two", () => {});
    expect(s.running).toBe(2);
    (listeners[1] as (e: GlossEvent) => void)({ event: "done", data: { markdown: "x" } });
    expect(s.running).toBe(1);
  });

  it("hands cancel to the backend", () => {
    const { backend, cancelled } = fakeBackend({ ok: true, gloss: "g-0001" });
    trackJobs(backend, sink().jobs).cancel("g-0042");
    expect(cancelled).toEqual(["g-0042"]);
  });
});
