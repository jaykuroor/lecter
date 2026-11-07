import { type JSX, Show } from "solid-js";
import { costLabel, MODE_LABEL, type SlidePos, type StatusMode, slideLabel } from "./labels";
import "./StatusLine.css";

/**
 * The status line (09-ui.md#layout, docs/design/components.md#status-line): along the bottom of
 * the document column, like lualine. The mode in its colours first, then course/lecture, then
 * `children` (the version and any notice) filling the middle, then the active model, the lecture's
 * cost, the job spinner while an answer streams, and the slide `n/N` last. A part that isn't known
 * (no course, no answer yet, a cost not reported) is left out rather than shown with a made-up
 * value. The spinner exists only while a job runs, so an idle window animates nothing.
 */
export function StatusLine(props: {
  mode: StatusMode;
  place: string | null;
  slide: SlidePos | null;
  model: string | null;
  /** The open lecture's AI cost in dollars, as the core reports it; `null` when it doesn't. */
  cost: number | null;
  running: number;
  children: JSX.Element;
}): JSX.Element {
  return (
    <footer class="status-line" role="status" aria-label="Status line">
      <span class="status-mode" data-mode={props.mode}>
        {MODE_LABEL[props.mode]}
      </span>
      <Show when={props.place}>{(place) => <span class="status-place">{place()}</span>}</Show>
      <span class="status-fill">{props.children}</span>
      <Show when={props.model}>
        {(model) => (
          <span class="status-model" title="Active model">
            {model()}
          </span>
        )}
      </Show>
      <Show when={costLabel(props.cost)}>
        {(cost) => (
          <span class="status-cost" title="Lecture cost">
            {cost()}
          </span>
        )}
      </Show>
      <Show when={props.running > 0}>
        <span
          class="status-jobs"
          role="img"
          aria-label={`${props.running} AI job${props.running === 1 ? "" : "s"} running`}
        >
          <span class="status-spinner" />
        </span>
      </Show>
      <Show when={props.slide}>
        {(slide) => (
          <span class="status-slide" title={slideLabel(slide()).words}>
            {slideLabel(slide()).text}
          </span>
        )}
      </Show>
    </footer>
  );
}
