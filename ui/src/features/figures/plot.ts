// Computing a function plot locally (08-figures.md#tiers: "rendered by Lecter"): each curve is
// sampled at evenly spaced x over the domain, broken where it is undefined, and the scatter's
// points are drawn from a fixed seed, so a figure looks the same each time it is drawn. Pure
// numbers here; ./draw turns them into SVG.
import type { FnplotSpec } from "./spec";

/** A point in data coordinates. */
export type Point = [number, number];

/** What a plot draws, in data coordinates. */
export interface PlotData {
  /** Per expression: its text and its defined runs of points. */
  curves: { text: string; segments: Point[][] }[];
  points: Point[];
  x: [number, number];
  y: [number, number];
}

/** Intervals each curve is sampled in (SAMPLES + 1 points). */
export const SAMPLES = 200;

/** The scatter's seed: the same spec always draws the same points. */
export const SEED = 0x5eed;

/** A small seeded generator of uniform numbers in [0, 1) (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `fn` at SAMPLES + 1 evenly spaced x over `domain`, split into runs where y is finite. */
export function sampleCurve(fn: (x: number) => number, domain: [number, number], samples = SAMPLES): Point[][] {
  const [lo, hi] = domain;
  const segments: Point[][] = [];
  let run: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i === samples ? hi : lo + ((hi - lo) * i) / samples;
    const y = fn(x);
    if (Number.isFinite(y)) run.push([x, y]);
    else if (run.length > 0) {
      segments.push(run);
      run = [];
    }
  }
  if (run.length > 0) segments.push(run);
  return segments;
}

/** The smallest and largest of `ys`; a flat range widens by 1 each way; none is null. */
export function range(ys: Iterable<number>): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const y of ys) {
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  if (lo > hi) return null;
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/** What `spec` draws, or null when no point of it is defined. */
export function plotData(spec: FnplotSpec): PlotData | null {
  const values = spec.params.map((p) => p.value);
  const curves = spec.exprs.map((e) => ({
    text: e.text,
    segments: sampleCurve((x) => e.fn([x, ...values]), spec.x),
  }));
  const points: Point[] = [];
  const s = spec.scatter;
  if (s) {
    const next = random(SEED);
    for (let i = 0; i < s.n; i++) {
      const x = s.lo + (s.hi - s.lo) * next();
      const y = s.y([x, ...values]);
      // Points outside the plot's domain aren't drawn.
      if (Number.isFinite(y) && x >= spec.x[0] && x <= spec.x[1]) points.push([x, y]);
    }
  }
  function* ys(): Generator<number> {
    for (const c of curves) for (const seg of c.segments) for (const p of seg) yield p[1];
    for (const p of points) yield p[1];
  }
  const y = range(ys());
  return y && { curves, points, x: spec.x, y };
}
