// The Settings window (12-settings-theme-onboarding.md#settings): a modal over the app, opened with
// Ctrl/Cmd-, or the headerbar's button. The search across every page, the file a change goes to
// (global, or the open course's own when it is trusted) and the close button along the top; the
// pages down the left; the page's settings, or the search's matches, on the right. Everything is
// reachable by mouse and by key (nav.ts); Tab stays in the window.
import { For, type JSX, Show } from "solid-js";
import type { SettingState } from "../../core/bindings";
import type { Binding } from "../../keys/keymap";
import { KeysList } from "./KeysList";
import { nextRow, rowTarget, windowKey } from "./nav";
import { PAGES, type PageId, pageTitle } from "./pages";
import { SettingRow } from "./SettingRow";
import type { SettingsWindow as Settings, SettingsCourse } from "./state";
import "./Settings.css";

export interface SettingsWindowProps {
  settings: Settings;
  course: () => SettingsCourse | null;
  bindings: () => readonly Binding[];
  mac: boolean;
  /** Closes the window (and gives the focus back). */
  onClose: () => void;
}

const tabId = (id: PageId) => `settings-tab-${id}`;

export function SettingsWindow(props: SettingsWindowProps): JSX.Element {
  const s = props.settings;
  let dialog!: HTMLDivElement;
  let search!: HTMLInputElement;
  let panel!: HTMLElement;
  const searching = () => s.query().trim() !== "";

  const focusTab = (id: PageId) => (dialog.querySelector(`#${tabId(id)}`) as HTMLElement).focus();
  const movePage = (by: 1 | -1 | "first" | "last") => {
    const at = PAGES.findIndex((p) => p.id === s.page());
    const to = by === "first" ? 0 : by === "last" ? PAGES.length - 1 : (at + by + PAGES.length) % PAGES.length;
    const page = (PAGES[to] as (typeof PAGES)[number]).id;
    s.showPage(page);
    focusTab(page);
  };
  const moveRow = (from: Element, by: 1 | -1) => {
    const row = nextRow(panel, from, by);
    if (!row) return;
    rowTarget(row).focus();
    row.scrollIntoView?.({ block: "nearest" });
  };
  /** The last Tab stop: the last setting's control, else the page's tab. */
  const lastStop = () => {
    const rows = panel.querySelectorAll<HTMLElement>(".settings-row");
    const last = rows[rows.length - 1];
    if (last) rowTarget(last).focus();
    else focusTab(s.page());
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as Element;
    const act = windowKey(e, target, s.query() !== "");
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    if (act.do === "close") props.onClose();
    else if (act.do === "clear") s.setQuery("");
    else if (act.do === "search") search.focus();
    else if (act.do === "page") movePage(act.by);
    else if (act.do === "row") moveRow(target, act.by);
  };

  return (
    <div class="settings-backdrop">
      <div
        ref={dialog}
        class="settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={onKeyDown}
      >
        {/* Shift-Tab from the first stop comes here and goes round to the last. */}
        <span class="settings-sentinel" tabindex="0" aria-hidden="true" onFocus={lastStop} />
        <header class="settings-head">
          <h2 id="settings-title" class="settings-title">
            Settings
          </h2>
          <input
            ref={search}
            class="settings-search"
            type="search"
            placeholder="Search settings"
            aria-label="Search settings"
            aria-keyshortcuts="/"
            value={s.query()}
            onInput={(e) => s.setQuery(e.currentTarget.value)}
          />
          <div class="settings-scope" role="radiogroup" aria-label="Change the settings of">
            <label class="settings-scope-choice">
              <input
                type="radio"
                name="settings-scope"
                checked={s.scope() === "global"}
                onChange={() => s.setScope("global")}
              />
              <span>Global</span>
            </label>
            <label
              class="settings-scope-choice"
              title={
                s.courseScope()
                  ? "Changes go to this course's .lecter/course.jsonc"
                  : "Open and trust a course to give it settings of its own"
              }
            >
              <input
                type="radio"
                name="settings-scope"
                checked={s.scope() === "course"}
                disabled={!s.courseScope()}
                onChange={() => s.setScope("course")}
              />
              <Show when={s.courseScope() ? props.course() : null} fallback={<span>This course</span>}>
                {(c) => <span>This course ({c().name})</span>}
              </Show>
            </label>
          </div>
          <button type="button" class="settings-close" aria-label="Close settings" onClick={() => props.onClose()}>
            <kbd class="sidebar-key">Esc</kbd>
          </button>
        </header>
        <nav class="settings-nav" aria-label="Settings pages">
          <div role="tablist" aria-orientation="vertical" aria-label="Settings pages">
            <For each={PAGES}>
              {(p) => (
                <button
                  type="button"
                  role="tab"
                  id={tabId(p.id)}
                  class="settings-tab"
                  aria-selected={!searching() && s.page() === p.id ? "true" : "false"}
                  aria-controls="settings-panel"
                  tabindex={s.page() === p.id ? 0 : -1}
                  onClick={() => s.showPage(p.id)}
                >
                  {p.title}
                </button>
              )}
            </For>
          </div>
        </nav>
        <section
          ref={panel}
          id="settings-panel"
          class="settings-panel"
          role="tabpanel"
          aria-labelledby={searching() ? "settings-results" : tabId(s.page())}
        >
          <h3 class="settings-page-title" id="settings-results">
            {searching() ? `Settings matching “${s.query().trim()}”` : pageTitle(s.page())}
          </h3>
          <Show when={s.loadError()}>
            {(line) => (
              <p class="settings-error" role="alert">
                {line()}
              </p>
            )}
          </Show>
          <Show when={!searching() && s.page() === "keys"}>
            <KeysList bindings={props.bindings()} mac={props.mac} />
          </Show>
          <For each={s.shown()}>
            {(entry) => <SettingRow entry={entry} state={s.values()[entry.spec.key] as SettingState} settings={s} />}
          </For>
          <Show when={searching() && s.shown().length === 0 && s.entries().length > 0}>
            <p class="settings-empty">No setting matches.</p>
          </Show>
        </section>
        {/* Tab from the last stop comes here and goes round to the search. */}
        <span class="settings-sentinel" tabindex="0" aria-hidden="true" onFocus={() => search.focus()} />
      </div>
    </div>
  );
}
