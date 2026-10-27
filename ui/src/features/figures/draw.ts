// A function plot as SVG, built with DOM calls only: every number is computed here and every
// label is set as text, so nothing from the model reaches markup, and nothing refers to a URL
// (no href, no src): drawing makes no request. Colours come from CSS classes (./Figure.css,
// design tokens).
import type { PlotData, Point } from "./plot";

/** The plot's coordinate box (its viewBox); the SVG scales to the column's width. */
export const WIDTH = 560;
export const HEIGHT = 220;
/** Room for the tick labels: left, right, top, bottom. */
export const PAD = { left: 44, right: 12, top: 10, bottom: 22 } as const;

const SVG = "http://www.w3.org/2000/svg";

/** Data-to-box mapping for `data`'s ranges. */
export function scales(data: Pick<PlotData, "x" | "y">): { sx: (x: number) => number; sy: (y: number) => number } {
  const [x0, x1] = data.x;
  const [y0, y1] = data.y;
  const w = WIDTH - PAD.left - PAD.right;
  const h = HEIGHT - PAD.top - PAD.bottom;
  return {
    sx: (x) => PAD.left + ((x - x0) / (x1 - x0)) * w,
    sy: (y) => HEIGHT - PAD.bottom - ((y - y0) / (y1 - y0)) * h,
  };
}

/** A box coordinate as SVG writes it: at most 2 decimals. */
const c = (v: number): string => String(Math.round(v * 100) / 100);

/** The path data of one run of points: `M x,y L x,y …`. */
export function pathData(run: Point[], sx: (x: number) => number, sy: (y: number) => number): string {
  return run.map(([x, y], i) => `${i === 0 ? "M" : "L"}${c(sx(x))},${c(sy(y))}`).join(" ");
}

/** A tick label's number: 3 significant digits, no trailing zeros, no "-0". */
export function tick(v: number): string {
  const s = String(Number(v.toPrecision(3)));
  return s === "-0" ? "0" : s;
}

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className: string,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  e.setAttribute("class", className);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function label(text: string, x: number, y: number, anchor: string): SVGTextElement {
  const t = node("text", "figure-tick", { x: c(x), y: c(y), "text-anchor": anchor });
  t.textContent = text;
  return t;
}

/**
 * `data` as an SVG plot: frame, the axes through 0 when in range, tick labels, the legend (each
 * curve's formula), curves and points.
 */
export function drawPlot(data: PlotData): SVGSVGElement {
  const { sx, sy } = scales(data);
  const [x0, x1] = data.x;
  const [y0, y1] = data.y;
  const svg = node("svg", "figure-plot", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img" });
  const exprs = data.curves.map((k) => `y = ${k.text}`).join(", ");
  svg.setAttribute("aria-label", `Plot of ${exprs} for x from ${tick(x0)} to ${tick(x1)}`);
  const [left, right, top, bottom] = [sx(x0), sx(x1), sy(y1), sy(y0)];
  svg.append(node("rect", "figure-frame", { x: c(left), y: c(top), width: c(right - left), height: c(bottom - top) }));
  if (y0 < 0 && y1 > 0) {
    svg.append(node("line", "figure-axis", { x1: c(left), x2: c(right), y1: c(sy(0)), y2: c(sy(0)) }));
  }
  if (x0 < 0 && x1 > 0) {
    svg.append(node("line", "figure-axis", { x1: c(sx(0)), x2: c(sx(0)), y1: c(top), y2: c(bottom) }));
  }
  svg.append(
    label(tick(x0), left, HEIGHT - 6, "start"),
    label(tick(x1), right, HEIGHT - 6, "end"),
    label(tick(y1), left - 6, top + 8, "end"),
    label(tick(y0), left - 6, bottom, "end"),
  );
  const legend = node("text", "figure-legend", { x: c(left + 8), y: c(top + 14), "text-anchor": "start" });
  legend.textContent = data.curves.map((k) => `y = ${k.text}`).join(" · ");
  svg.append(legend);
  data.curves.forEach((k, i) => {
    for (const run of k.segments) {
      svg.append(node("path", `figure-curve figure-curve-${i % 4}`, { d: pathData(run, sx, sy) }));
    }
  });
  for (const [x, y] of data.points) {
    svg.append(node("circle", "figure-point", { cx: c(sx(x)), cy: c(sy(y)), r: "2" }));
  }
  return svg;
}
