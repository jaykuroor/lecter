// A setting the app applies as it changes (12-settings-theme-onboarding.md#settings: a change
// applies at once): its value in force is read for the course open now, again when the course
// changes, and taken from every `settings:changed` of its key. A read that comes back after a newer
// value (a key pressed, an event) is dropped, so the last change always wins. Nothing here is on the
// key path: the app's own toggles (␣uh, ␣uk) apply locally first and write through `write`.
import { createEffect, createRoot, on } from "solid-js";
import type { IpcError, Setting } from "../../core/bindings";

/** A command's answer from the core: the data, or the core's error. */
type Answer<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/** The core as a follower uses it; tests pass fakes. */
export interface FollowDeps {
  get(key: string, course: string | null): Promise<Answer<Setting>>;
  /** Calls `listener` for each written setting; resolves to the function that stops it. */
  listen(listener: (setting: Setting) => void): Promise<() => void>;
  /** Writes a value (JSON text) to the global settings; answers the value in force for `course`. */
  set(key: string, json: string, course: string | null): Promise<Answer<Setting>>;
}

export interface Follower {
  /**
   * The app changed the value itself (␣uh, ␣uk) and shows it already: writes it to the global
   * settings, and no older read may undo it. The value then in force for the open course follows
   * (`settings:changed`), so a course that sets its own keeps it; a refused write reads the value
   * in force again, so the app never shows one that wasn't saved.
   */
  write: (json: string) => void;
  stop: () => void;
}

/** Applies `key`'s value in force (JSON text) through `apply` from now on, for `course()`. */
export function followSetting(
  deps: FollowDeps,
  key: string,
  course: () => string | null,
  apply: (json: string) => void,
): Follower {
  let stopped = false;
  /** Bumped by every newer value; a read applies only if none came after it was asked. */
  let version = 0;
  let unlisten: (() => void) | undefined;
  const read = () => {
    const asked = ++version;
    void deps.get(key, course()).then((answer) => {
      if (!stopped && asked === version && answer.status === "ok") apply(answer.data.value);
    });
  };
  const dispose = createRoot((done) => {
    createEffect(on(course, read));
    return done;
  });
  void deps
    .listen((setting) => {
      if (stopped || setting.key !== key) return;
      version += 1;
      apply(setting.value);
    })
    .then(
      (stop) => {
        if (stopped) stop();
        else unlisten = stop;
      },
      () => {},
    );
  return {
    write: (json) => {
      version += 1;
      void deps.set(key, json, course()).then((answer) => {
        if (!stopped && answer.status !== "ok") read();
      });
    },
    stop: () => {
      stopped = true;
      dispose();
      unlisten?.();
    },
  };
}
