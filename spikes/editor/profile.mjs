// Where does a keystroke's main-thread time go? Chromium CPU profile of the same typing pass as
// measure.mjs, on an unminified build so function names survive. Not part of the measurement.
//
//   npx vite build --minify false --outDir dist-profile && node profile.mjs [--keys 300]
//
// Prints the top functions by self time (ms) and by inclusive time for named editor functions.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const HERE = import.meta.dirname;
const DIST = join(HERE, "dist-profile");
const i = process.argv.indexOf("--keys");
const KEYS = i > 0 ? Number(process.argv[i + 1]) : 300;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  const path = normalize(new URL(req.url, "http://x").pathname);
  const file = join(DIST, path === "/" ? "index.html" : path);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${base}/?slides=200`);
await page.waitForFunction(() => window.__ready === true);
await page.evaluate(() => window.__gotoSlide(100));
await page.keyboard.press("Escape");
await page.keyboard.press("o");
const text = "Variance of a sum adds $2\\operatorname{Cov}(X,Y)$ cross terms; check with dice. ";
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await cdp.send("Profiler.start");
for (let k = 0; k < KEYS; k++) {
  if (k > 0 && k % 60 === 0) for (const m of ["Escape", "k", "j", "w", "b", "A"]) await page.keyboard.press(m);
  await page.keyboard.press(text[k % text.length]);
  await page.evaluate(() => window.__probe.flush());
}
const { profile } = await cdp.send("Profiler.stop");
await browser.close();
server.close();

// Self time per node from samples, then aggregate by function name + location.
const dt = new Map();
for (let s = 0; s < profile.samples.length; s++) {
  const id = profile.samples[s];
  dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[s] ?? 0) / 1000);
}
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => {
  const f = n.callFrame;
  const file = f.url.split("/").pop() || f.url || "(native)";
  return `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}`;
};
const self = new Map();
const incl = new Map();
for (const [id, ms] of dt) {
  const k = key(byId.get(id));
  self.set(k, (self.get(k) ?? 0) + ms);
  const seen = new Set();
  for (let p = id; p !== undefined; p = parent.get(p)) {
    const pk = key(byId.get(p));
    if (seen.has(pk)) continue;
    seen.add(pk);
    incl.set(pk, (incl.get(pk) ?? 0) + ms);
  }
}
const top = (m, n, filter = () => true) =>
  [...m]
    .filter(([k]) => filter(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `  ${v.toFixed(1).padStart(8)} ms  ${(v / KEYS).toFixed(3)} ms/key  ${k}`)
    .join("\n");
const busy = [...self].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).reduce((a, [, v]) => a + v, 0);
console.log(`${KEYS} keys; JS+GC self time ${busy.toFixed(1)} ms (${(busy / KEYS).toFixed(2)} ms/key)`);
console.log("Top self time:");
console.log(top(self, 25, (k) => !k.startsWith("(idle)") && !k.startsWith("(program)")));
console.log("Top inclusive time (spike + editor code):");
console.log(top(incl, 25, (k) => /index-|\.ts|\.js:/.test(k) && !k.startsWith("(")));
console.log("Spike's own decoration code (inclusive):");
console.log(top(incl, 12, (k) => /^(scan|scanRange|slideStart|slideEnd|insideAt|inlineDecos|fullBuild|touchedLines|renderTex|cursorTouches|toDOM|build) index-/.test(k)));
