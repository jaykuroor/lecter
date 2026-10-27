import { describe, expect, it } from "vitest";
import { drawPlot, HEIGHT, PAD, pathData, scales, tick, WIDTH } from "./draw";
import { plotData, random, range, SAMPLES, sampleCurve } from "./plot";
import { renderFnplot } from "./runtime";
import { type FnplotSpec, parseFnplot } from "./spec";

/** The example of 08-figures.md#tiers. */
const EXAMPLE = `{ "type": "fnplot", "exprs": ["x^2"], "x": [-1, 1], "params": { "n": { "min": 10, "max": 1000, "value": 100 } },
  "scatter": { "sample": "x ~ U(-1,1); y = x^2", "n": "n" } }`;

function spec(source: string): FnplotSpec {
  const r = parseFnplot(source);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
}

describe("computing a plot", () => {
  it("samples a curve evenly over the domain, ends included", () => {
    expect(sampleCurve((x) => x * x, [-1, 1], 4)).toEqual([
      [
        [-1, 1],
        [-0.5, 0.25],
        [0, 0],
        [0.5, 0.25],
        [1, 1],
      ],
    ]);
    const xs = sampleCurve((x) => x, [0.1, 0.7], 3)[0]?.map((p) => p[0]);
    expect(xs?.length).toBe(4);
    expect(xs?.[3]).toBe(0.7);
    expect(sampleCurve((x) => x, [0, 1]).flat().length).toBe(SAMPLES + 1);
  });

  it("breaks a curve where it is undefined", () => {
    expect(sampleCurve((x) => 1 / x, [-1, 1], 2)).toEqual([[[-1, -1]], [[1, 1]]]);
    expect(sampleCurve(Math.sqrt, [-1, 1], 2)).toEqual([
      [
        [0, 0],
        [1, 1],
      ],
    ]);
    expect(sampleCurve(() => Number.NaN, [0, 1], 2)).toEqual([]);
  });

  it("finds the y range, widening a flat one", () => {
    expect(range([3, 1, 2])).toEqual([1, 3]);
    expect(range([-2, -5])).toEqual([-5, -2]);
    expect(range([5])).toEqual([4, 6]);
    expect(range([])).toBe(null);
  });

  it("draws the same uniform numbers for the same seed", () => {
    const a = random(7);
    const b = random(7);
    const first = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(first).size).toBe(50);
    expect(random(8)()).not.toBe(random(7)());
    // Spread over [0, 1): both halves get some.
    expect(first.some((v) => v < 0.5) && first.some((v) => v >= 0.5)).toBe(true);
  });

  it("computes the spec's example: y = x² on [-1, 1] with 100 points on the curve", () => {
    const data = plotData(spec(EXAMPLE));
    if (!data) throw new Error("no data");
    expect(data.x).toEqual([-1, 1]);
    expect(data.y).toEqual([0, 1]);
    expect(data.curves.map((k) => k.text)).toEqual(["x^2"]);
    const run = data.curves[0]?.segments[0] ?? [];
    expect(run.length).toBe(SAMPLES + 1);
    expect(run[0]).toEqual([-1, 1]);
    expect(run[SAMPLES / 2]).toEqual([0, 0]);
    expect(data.points.length).toBe(100);
    for (const [x, y] of data.points) {
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThan(1);
      expect(y).toBe(x ** 2);
    }
    // Drawn again, the points are the same.
    expect(plotData(spec(EXAMPLE))?.points).toEqual(data.points);
  });

  it("uses param values and keeps only points inside the domain", () => {
    const data = plotData(
      spec(
        '{"type":"fnplot","exprs":["k*x"],"x":[0,2],"params":{"k":{"min":0,"max":9,"value":3}},"scatter":{"sample":"x ~ U(-2,2); y = k","n":400}}',
      ),
    );
    if (!data) throw new Error("no data");
    expect(data.curves[0]?.segments[0]?.at(-1)).toEqual([2, 6]);
    expect(data.y).toEqual([0, 6]);
    expect(data.points.every(([x, y]) => x >= 0 && x <= 2 && y === 3)).toBe(true);
    // About half of U(-2, 2) falls in [0, 2].
    expect(data.points.length).toBeGreaterThan(150);
    expect(data.points.length).toBeLessThan(250);
  });

  it("has nothing to draw when no point is defined", () => {
    expect(plotData(spec('{"type":"fnplot","exprs":["sqrt(-1)"],"x":[0,1]}'))).toBe(null);
  });
});

describe("drawing a plot", () => {
  it("maps the data ranges onto the box inside the padding", () => {
    const { sx, sy } = scales({ x: [-1, 1], y: [0, 1] });
    expect(sx(-1)).toBe(PAD.left);
    expect(sx(1)).toBe(WIDTH - PAD.right);
    expect(sx(0)).toBe((PAD.left + WIDTH - PAD.right) / 2);
    expect(sy(0)).toBe(HEIGHT - PAD.bottom);
    expect(sy(1)).toBe(PAD.top);
    expect(sy(0.5)).toBe((PAD.top + HEIGHT - PAD.bottom) / 2);
  });

  it("writes path data with at most two decimals", () => {
    expect(
      pathData(
        [[1, 2]],
        (x) => x,
        (y) => y,
      ),
    ).toBe("M1,2");
    expect(
      pathData(
        [
          [0, 0],
          [1 / 3, 2 / 3],
        ],
        (x) => x,
        (y) => y,
      ),
    ).toBe("M0,0 L0.33,0.67");
  });

  it("labels ticks with three significant digits", () => {
    expect(tick(0.1 + 0.2)).toBe("0.3");
    expect(tick(-0)).toBe("0");
    expect(tick(1234.5)).toBe("1230");
    expect(tick(-1)).toBe("-1");
    expect(tick(1e-7)).toBe("1e-7");
  });

  it("draws the example: frame, the y axis through x = 0, ticks, one curve and 100 points", () => {
    const data = plotData(spec(EXAMPLE));
    if (!data) throw new Error("no data");
    const svg = drawPlot(data);
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${WIDTH} ${HEIGHT}`);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Plot of y = x^2 for x from -1 to 1");
    const frame = svg.querySelector(".figure-frame");
    expect([frame?.getAttribute("x"), frame?.getAttribute("y")]).toEqual([`${PAD.left}`, `${PAD.top}`]);
    expect(frame?.getAttribute("width")).toBe(`${WIDTH - PAD.left - PAD.right}`);
    expect(frame?.getAttribute("height")).toBe(`${HEIGHT - PAD.top - PAD.bottom}`);
    // y runs from 0 to 1, so no x axis line; x runs from -1 to 1, so the y axis is at x = 0.
    const axes = [...svg.querySelectorAll(".figure-axis")];
    expect(axes.map((a) => [a.getAttribute("x1"), a.getAttribute("x2")])).toEqual([["296", "296"]]);
    expect([...svg.querySelectorAll(".figure-tick")].map((t) => t.textContent)).toEqual(["-1", "1", "1", "0"]);
    const paths = svg.querySelectorAll(".figure-curve");
    expect(paths.length).toBe(1);
    const d = paths[0]?.getAttribute("d") ?? "";
    expect(d.startsWith(`M${PAD.left},${PAD.top} L`)).toBe(true);
    expect(d).toContain(` L296,${HEIGHT - PAD.bottom} `);
    expect(d.endsWith(` L${WIDTH - PAD.right},${PAD.top}`)).toBe(true);
    expect(svg.querySelectorAll(".figure-point").length).toBe(100);
  });

  it("draws an x axis through y = 0 when y changes sign, and a curve per run", () => {
    const svg = drawPlot({
      curves: [
        { text: "1/x", segments: [[[1, 1]], [[2, 2]]] },
        { text: "2", segments: [] },
        { text: "3", segments: [] },
        { text: "4", segments: [] },
        { text: "5", segments: [[[1, 0.5]]] },
      ],
      points: [],
      x: [1, 2],
      y: [-1, 1],
    });
    const axes = [...svg.querySelectorAll(".figure-axis")];
    expect(axes.map((a) => [a.getAttribute("y1"), a.getAttribute("y2")])).toEqual([["104", "104"]]);
    expect(axes.map((a) => [a.getAttribute("x1"), a.getAttribute("x2")])).toEqual([["44", "548"]]);
    expect(svg.querySelector(".figure-legend")?.textContent).toBe("y = 1/x · y = 2 · y = 3 · y = 4 · y = 5");
    // One path per run; the fifth curve takes the first colour again.
    const curves = [...svg.querySelectorAll(".figure-curve")].map((p) => p.getAttribute("class"));
    expect(curves).toEqual([
      "figure-curve figure-curve-0",
      "figure-curve figure-curve-0",
      "figure-curve figure-curve-0",
    ]);
  });

  it("refers to no URL, so drawing makes no request", () => {
    const data = plotData(spec(EXAMPLE));
    if (!data) throw new Error("no data");
    const svg = drawPlot(data);
    const all = [svg, ...svg.querySelectorAll("*")];
    const refs = all.flatMap((e) => [...e.attributes].filter((a) => /href|src|url\(/i.test(`${a.name} ${a.value}`)));
    expect(refs.map((a) => a.name)).toEqual([]);
    expect([...new Set(all.map((e) => e.localName))].sort()).toEqual(["circle", "line", "path", "rect", "svg", "text"]);
  });
});

describe("the figure runtime", () => {
  it("draws a spec with its legend", () => {
    const host = document.createElement("div");
    expect(renderFnplot(host, EXAMPLE)).toBe("plot");
    expect(host.children.length).toBe(1);
    expect(host.querySelector("svg.figure-plot path.figure-curve")).not.toBe(null);
    expect(host.querySelector(".figure-legend")?.textContent).toBe("y = x^2");
    // Drawing again replaces the plot.
    renderFnplot(host, EXAMPLE);
    expect(host.querySelectorAll("svg").length).toBe(1);
  });

  it("shows why a spec can't be drawn, as text", () => {
    const host = document.createElement("figure");
    expect(renderFnplot(host, "{")).toBe("error");
    expect(host.textContent).toBe("This plot can't be drawn: not JSON.");
    expect(renderFnplot(host, '{"type":"fnplot","exprs":["sqrt(-1)"],"x":[0,1]}')).toBe("error");
    expect(host.textContent).toBe("This plot can't be drawn: no point of it is defined.");
    const evil = JSON.stringify({ type: "fnplot", exprs: ["<img src=x onerror=alert(1)>"], x: [0, 1] });
    expect(renderFnplot(host, evil)).toBe("error");
    expect(host.querySelector("img")).toBe(null);
    expect(host.querySelector(".figure-error")?.textContent).toBe(
      "This plot can't be drawn: exprs[0]: unexpected character at 1.",
    );
  });
});
