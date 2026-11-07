import { createEffect, For, type JSX, Show } from "solid-js";
import type { TrustScreen as Screen, TrustChoice } from "../../core/course";
import { aiFiles, inside } from "./summary";
import "./TrustScreen.css";

/**
 * The trust screen (02-course-folder.md#trust): shown over the document the first time a folder is
 * opened, and again when it moved or its AI files changed. It says what is inside, what the AI may
 * read, which provider receives excerpts and whether web search is on, and lists the course's own
 * AGENTS.md, roles, skills and settings overrides (SEC-25), and every link in slides/ that leaves the
 * folder with where it leads (D-167, read only once trusted). Trust gives full features; Open
 * read-only keeps notes and slides only, and the core refuses AI and indexing (SEC-27).
 *
 * Both answers are buttons, reached by mouse, by Tab, and by Enter or Space. Focus starts on Open
 * read-only, so a stray Enter never trusts a folder.
 */
export function TrustScreen(props: {
  /** The folder's name. */
  name: string;
  /** Its absolute path. */
  path: string;
  screen: Screen;
  /** An answer is being saved. */
  busy: boolean;
  onAnswer: (choice: TrustChoice) => void;
}): JSX.Element {
  // Set by its `ref` during render, before any effect runs.
  let readOnly!: HTMLButtonElement;
  // Focus moves to Open read-only once it can be pressed: the screen may appear while the open that
  // brought it is still finishing (busy, buttons disabled), and a disabled button takes no focus.
  let focused = false;
  createEffect(() => {
    if (focused || props.busy) return;
    focused = true;
    readOnly.focus();
  });
  // Enter and Space are handled here, not left to the browser's button activation: that runs only
  // for trusted key events, so a synthetic key (the embedded WebDriver, assistive tools) would do
  // nothing. preventDefault stops a real keypress from also clicking. While an answer is saved
  // both buttons are disabled, and Solid runs no handler of a disabled button.
  const keys = (choice: TrustChoice) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    props.onAnswer(choice);
  };
  return (
    <section class="trust" role="dialog" aria-labelledby="trust-title" aria-describedby="trust-inside">
      <header class="trust-head">
        <h2 id="trust-title" class="trust-title">
          Trust “{props.name}”?
        </h2>
        <p class="trust-path" title={props.path}>
          {props.path}
        </p>
      </header>
      <Show when={props.screen.changed}>
        <p class="trust-changed" role="note">
          <span class="trust-changed-icon" aria-hidden="true">
            !
          </span>
          This course's AI instructions changed since you last answered.
        </p>
      </Show>
      <Show when={props.screen.blocked}>
        {(why) => (
          <p class="trust-changed trust-blocked" role="note">
            <span class="trust-changed-icon" aria-hidden="true">
              !
            </span>
            Lecter can't check this course's AI setup, so it can only open it read-only: {why()}
          </p>
        )}
      </Show>
      <p id="trust-inside" class="trust-inside">
        {inside(props.screen)}
      </p>
      <dl class="trust-facts">
        <dt>The AI may read</dt>
        <dd class="trust-reads">
          Everything in this folder except what .lecterignore lists
          {props.screen.links.length > 0 ? ", and the linked slides below" : ""}
        </dd>
        <dt>Excerpts go to</dt>
        <dd class="trust-provider">{props.screen.provider}</dd>
        <dt>Web search</dt>
        <dd class="trust-web">{props.screen.webSearch ? "On" : "Off"}</dd>
      </dl>
      <section class="trust-files" aria-label="This course's AI setup">
        <For each={aiFiles(props.screen)}>
          {(group) => (
            <section class="trust-group" aria-label={group.label}>
              <h3 class="trust-group-label">{group.label}</h3>
              <Show when={group.items.length > 0} fallback={<p class="trust-none">None</p>}>
                <ul class="trust-list">
                  <For each={group.items}>{(item) => <li class="trust-item">{item}</li>}</For>
                </ul>
              </Show>
            </section>
          )}
        </For>
      </section>
      <Show when={props.screen.links.length > 0}>
        <section class="trust-links" aria-label="Links out of this folder">
          <h3 class="trust-group-label">Links out of this folder</h3>
          <p class="trust-links-note">
            Listed as slides. Lecter reads them only if you trust this course; read-only never opens them.
          </p>
          <ul class="trust-list">
            <For each={props.screen.links}>{(link) => <li class="trust-item">{link}</li>}</For>
          </ul>
        </section>
      </Show>
      <p class="trust-choices">
        <b>Trust</b>: full features. <b>Open read-only</b>: notes and slides only; no AI, no figures with scripts, no
        indexing.
      </p>
      <div class="trust-actions">
        <button
          ref={readOnly}
          type="button"
          class="btn"
          disabled={props.busy}
          onClick={() => props.onAnswer("read_only")}
          onKeyDown={keys("read_only")}
        >
          Open read-only
        </button>
        <button
          type="button"
          class="btn sug"
          disabled={props.busy || props.screen.blocked !== null}
          onClick={() => props.onAnswer("trusted")}
          onKeyDown={keys("trusted")}
        >
          Trust
        </button>
      </div>
    </section>
  );
}

/** "Read-only" beside a course opened read-only, so it is clear why AI and search are off. */
export function ReadOnlyChip(): JSX.Element {
  return (
    <span class="chip trust-chip" title="Opened read-only: no AI, no figures with scripts, no indexing">
      Read-only
    </span>
  );
}
