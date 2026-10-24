// F-001 measurement: p99 keystroke-to-paint and memory for the spike surface in Chromium and WebKit.
//
//   node measure.mjs [--engines chromium,webkit] [--slides 200] [--keys 500] [--warmup 50]
//
// Expects `vite build` output in ./dist (`pnpm run measure` does both). Writes data/<engine>.json
// (git-ignored) and prints a summary plus GO / NO-GO against keystroke_p99_ms (< 8 ms).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, webkit } from "@playwright/test";

const HERE = import.meta.dirname;
const DIST = join(HERE, "dist");
const BUDGET_MS = 8;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}
const ENGINES = arg("engines", "chromium,chromium-novsync,webkit").split(",");
const SLIDES = Number(arg("slides", "200"));
const KEYS = Number(arg("keys", "500"));
const WARMUP = Number(arg("warmup", "50"));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
function serve() {
  const server = createServer((req, res) => {
    const path = normalize(new URL(req.url, "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(DIST, path === "/" ? "index.html" : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

/** RSS (MB) of `pid` and all its descendants, via `ps` (Linux and macOS). */
function treeRssMb(pid) {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [p, pp] of rows) kids.set(pp, [...(kids.get(pp) ?? []), p]);
  const rss = new Map(rows.map(([p, , r]) => [p, r]));
  let total = 0;
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    total += rss.get(p) ?? 0;
    stack.push(...(kids.get(p) ?? []));
  }
  return +(total / 1024).toFixed(1);
}

async function jsHeapMb(engine, page) {
  if (!engine.startsWith("chromium")) return null; // WebKit exposes no JS heap API to Playwright.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  return +(usedSize / 1048576).toFixed(1);
}

function keySequence(n) {
  const text = "Variance of a sum adds $2\\operatorname{Cov}(X,Y)$ cross terms; check with dice. ";
  const keys = [];
  let i = 0;
  while (keys.length < n) {
    if (i > 0 && i % 60 === 0) keys.push("Escape", "k", "j", "w", "b", "A");
    keys.push(text[i % text.length]);
    i++;
  }
  return keys.slice(0, n);
}

function pct(sorted, p) {
  return +sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(2);
}
function summary(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: +s[s.length - 1].toFixed(2) };
}

/** Put the cursor on the middle slide, Vim `o`, type `keys` one by one; returns the probe's samples. */
async function typePass(page, keys) {
  const line = await page.evaluate((n) => window.__gotoSlide(n), Math.ceil(SLIDES / 2));
  if (line < 0) throw new Error("slide not found");
  await page.keyboard.press("Escape");
  await page.keyboard.press("o"); // Vim: open a line below, insert mode
  await page.evaluate(() => window.__probe.flush());
  await page.evaluate(() => window.__probe.reset());
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.evaluate(() => window.__probe.flush());
  }
  const s = await page.evaluate(() => window.__probe.samples());
  if (s.work.length !== keys.length) throw new Error(`expected ${keys.length} samples, got ${s.work.length}`);
  return s;
}

/** Second pass on a fresh page with ?sync=1: handler = input handling through forced layout, no rAF. */
async function syncPass(page, base, keys) {
  await page.goto(`${base}/?slides=${SLIDES}&sync=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  const s = await typePass(page, keys);
  return summary(s.handler.slice(WARMUP));
}

/** Smallest non-zero step of performance.now() (WebKit coarsens it). */
function timerResolution() {
  let min = Number.POSITIVE_INFINITY;
  let last = performance.now();
  const until = last + 50;
  while (last < until) {
    const t = performance.now();
    if (t > last) min = Math.min(min, t - last);
    last = t;
  }
  return +min.toFixed(4);
}

/** Mean handler and frame share of the slowest 5 % and 1 % of keystrokes (by work). */
function tail(work, handler, frame) {
  const idx = work.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const part = (share) => {
    const top = idx.slice(0, Math.max(1, Math.round(work.length * share)));
    const mean = (xs) => +(top.reduce((a, i) => a + xs[i], 0) / top.length).toFixed(2);
    return { n: top.length, work: mean(work), handler: mean(handler), frame: mean(frame) };
  };
  return { top5: part(0.05), top1: part(0.01) };
}

async function measure(name, { type, args }, base) {
  const server = await type.launchServer({ headless: true, args });
  const browser = await type.connect(server.wsEndpoint());
  const pid = server.process().pid;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/?slides=${SLIDES}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    const firstPaintMs = +(await page.evaluate(() => window.__firstPaintMs)).toFixed(1);
    const stats = await page.evaluate(() => window.__stats());
    const mem = { loaded: { rssMb: treeRssMb(pid), jsHeapMb: await jsHeapMb(name, page) } };

    await page.evaluate(() => window.__scrollThrough());
    mem.scrolled = { rssMb: treeRssMb(pid), jsHeapMb: await jsHeapMb(name, page) };

    const keys = keySequence(WARMUP + KEYS);
    const main = await typePass(page, keys);
    const { raw, work, handler, frame, missed } = main;
    mem.typed = { rssMb: treeRssMb(pid), jsHeapMb: await jsHeapMb(name, page) };
    const typedOk = await page.evaluate(() => document.querySelector(".cm-content")?.textContent?.includes("cross terms; check"));

    return {
      engine: name,
      version: browser.version(),
      fixture: stats,
      firstPaintMs,
      timerResolutionMs: await page.evaluate(timerResolution),
      keystrokes: {
        work: summary(work.slice(WARMUP)),
        raw: summary(raw.slice(WARMUP)),
        handler: summary(handler.slice(WARMUP)),
        frame: summary(frame.slice(WARMUP)),
        tail: tail(work.slice(WARMUP), handler.slice(WARMUP), frame.slice(WARMUP)),
        sync: await syncPass(page, base, keys),
        missedEvents: missed,
        typedOk,
      },
      memory: mem,
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

function bundleKbGz() {
  const dir = join(DIST, "assets");
  let total = 0;
  for (const f of readdirSync(dir)) if (f.endsWith(".js")) total += gzipSync(readFileSync(join(dir, f))).length;
  return +(total / 1024).toFixed(1);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
mkdirSync(join(HERE, "data"), { recursive: true });
// chromium-novsync: frames are produced as soon as they are needed, so its "raw" number is an
// end-to-end keystroke-to-paint without the vsync wait (a cross-check of the probe's "work").
const types = {
  chromium: { type: chromium, args: [] },
  "chromium-novsync": { type: chromium, args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] },
  webkit: { type: webkit, args: [] },
};
const results = [];
let failed = false;
console.log(`F-001 editor spike · ${SLIDES} slides · ${KEYS} keystrokes (+${WARMUP} warm-up) · bundle ${bundleKbGz()} KB gz JS`);
for (const name of ENGINES) {
  try {
    const r = await measure(name, types[name], base);
    results.push(r);
    writeFileSync(join(HERE, "data", `${name}.json`), JSON.stringify(r, null, 2));
    const k = r.keystrokes;
    console.log(
      `${name} ${r.version}: fixture ${r.fixture.lines} lines / ${r.fixture.chars} chars; first paint ${r.firstPaintMs} ms\n` +
        `  keystroke work  p50 ${k.work.p50} p95 ${k.work.p95} p99 ${k.work.p99} max ${k.work.max} ms (n=${k.work.n})\n` +
        `  keystroke raw   p50 ${k.raw.p50} p95 ${k.raw.p95} p99 ${k.raw.p99} max ${k.raw.max} ms (includes vsync wait)\n` +
        `  handler         p50 ${k.handler.p50} p95 ${k.handler.p95} p99 ${k.handler.p99} max ${k.handler.max} ms\n` +
        `  frame           p50 ${k.frame.p50} p95 ${k.frame.p95} p99 ${k.frame.p99} max ${k.frame.max} ms\n` +
        `  tail (slowest 5% / 1%): work ${k.tail.top5.work} / ${k.tail.top1.work} = handler ${k.tail.top5.handler} / ${k.tail.top1.handler} + frame ${k.tail.top5.frame} / ${k.tail.top1.frame} ms\n` +
        `  sync (2nd pass, no rAF, through layout) p50 ${k.sync.p50} p95 ${k.sync.p95} p99 ${k.sync.p99} max ${k.sync.max} ms\n` +
        `  timer resolution ${r.timerResolutionMs} ms\n` +
        `  typed text visible: ${k.typedOk}; events without an end mark: ${k.missedEvents}\n` +
        `  memory loaded   rss ${r.memory.loaded.rssMb} MB, js heap ${r.memory.loaded.jsHeapMb ?? "n/a"} MB\n` +
        `  memory scrolled rss ${r.memory.scrolled.rssMb} MB, js heap ${r.memory.scrolled.jsHeapMb ?? "n/a"} MB\n` +
        `  memory typed    rss ${r.memory.typed.rssMb} MB, js heap ${r.memory.typed.jsHeapMb ?? "n/a"} MB`,
    );
  } catch (e) {
    failed = true;
    console.log(`${name}: NOT MEASURED: ${String(e.message ?? e).split("\n").slice(0, 6).join(" | ")}`);
  }
}
server.close();
// The number held against the budget, per engine:
// - chromium-novsync: raw p99, a true end-to-end keystroke-to-paint (no vsync wait to exclude).
// - webkit: work p99. Vsync can't be switched off, and in vsync runs the after-paint task sometimes
//   lands a frame late, so this is an upper bound (compare chromium work with chromium-novsync raw).
// - chromium (vsync): context only, for that comparison.
const budgetP99 = (r) =>
  r.engine === "chromium-novsync" ? r.keystrokes.raw.p99 : r.engine === "webkit" ? r.keystrokes.work.p99 : null;
for (const r of results) {
  const b = budgetP99(r);
  if (b !== null) console.log(`budget metric ${r.engine}: p99 ${b} ms (${b < BUDGET_MS ? "within" : "over"} ${BUDGET_MS} ms)`);
}
const judged = results.filter((r) => budgetP99(r) !== null);
const go = judged.length > 0 && judged.every((r) => budgetP99(r) < BUDGET_MS && r.keystrokes.typedOk);
console.log(
  failed
    ? `VERDICT: INCOMPLETE (an engine was not measured)${go ? "; GO for the engines measured" : ""}`
    : `VERDICT: ${go ? "GO" : "NO-GO"} (keystroke p99 < ${BUDGET_MS} ms)`,
);
process.exit(failed ? 2 : go ? 0 : 1);
