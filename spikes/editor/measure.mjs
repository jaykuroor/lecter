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
const ENGINES = arg("engines", "chromium,webkit").split(",");
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
  if (engine !== "chromium") return null; // WebKit exposes no JS heap API to Playwright.
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

async function measure(name, type, base) {
  const server = await type.launchServer({ headless: true });
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

    const line = await page.evaluate((n) => window.__gotoSlide(n), Math.ceil(SLIDES / 2));
    if (line < 0) throw new Error("slide not found");
    await page.keyboard.press("Escape");
    await page.keyboard.press("o"); // Vim: open a line below, insert mode
    await page.evaluate(() => window.__probe.flush());
    const keys = keySequence(WARMUP + KEYS);
    await page.evaluate(() => window.__probe.reset());
    for (const k of keys) {
      await page.keyboard.press(k);
      await page.evaluate(() => window.__probe.flush());
    }
    const { raw, work } = await page.evaluate(() => window.__probe.samples());
    if (work.length !== keys.length) throw new Error(`expected ${keys.length} samples, got ${work.length}`);
    mem.typed = { rssMb: treeRssMb(pid), jsHeapMb: await jsHeapMb(name, page) };
    const typedOk = await page.evaluate(() => document.querySelector(".cm-content")?.textContent?.includes("cross terms; check"));

    return {
      engine: name,
      version: browser.version(),
      fixture: stats,
      firstPaintMs,
      keystrokes: { work: summary(work.slice(WARMUP)), raw: summary(raw.slice(WARMUP)), typedOk },
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
const types = { chromium, webkit };
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
        `  typed text visible: ${k.typedOk}\n` +
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
const go = results.length === ENGINES.length && results.every((r) => r.keystrokes.work.p99 < BUDGET_MS && r.keystrokes.typedOk);
console.log(
  failed
    ? "VERDICT: INCOMPLETE (an engine was not measured)"
    : `VERDICT: ${go ? "GO" : "NO-GO"} (keystroke work p99 < ${BUDGET_MS} ms in every engine)`,
);
process.exit(failed ? 2 : go ? 0 : 1);
