// The figure runtime, loaded the first time a figure comes into view (ui/CLAUDE.md: lazy-load the
// figure runtime): reads a function plot spec, computes the plot and draws it into the figure.
// A spec that can't be drawn shows why, as text.
import { drawPlot } from "./draw";
import { plotData } from "./plot";
import { parseFnplot } from "./spec";

/** What a figure shows after a render. */
export type Drawn = "plot" | "error";

/** Draws the function plot spec `source` into `host`, replacing what it showed. */
export function renderFnplot(host: HTMLElement, source: string): Drawn {
  const parsed = parseFnplot(source);
  const data = parsed.ok ? plotData(parsed.spec) : null;
  if (!data) {
    const why = parsed.ok ? "no point of it is defined" : parsed.error;
    const p = document.createElement("p");
    p.className = "figure-error";
    p.textContent = `This plot can't be drawn: ${why}.`;
    host.replaceChildren(p);
    return "error";
  }
  host.replaceChildren(drawPlot(data));
  return "plot";
}
