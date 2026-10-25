// F-017 / SEC-36: what Tauri's isolation pattern adds to one IPC call.
//
//   node spikes/isolation/measure.mjs [--engines chromium,webkit] [--calls 2000]
//
// Uses ui/'s Playwright (run `pnpm -C ui install` first). Prints a table per engine and a
// summary; writes nothing. See README.md for the method and what it does not cover.
import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";

const HERE = import.meta.dirname;
const require = createRequire(join(HERE, "../../ui/package.json"));
const playwright = require("@playwright/test");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}
const ENGINES = arg("engines", "chromium").split(",");
const CALLS = Number(arg("calls", "2000"));
// Inserted text per call: a keystroke edit, a pasted paragraph, a prompt at its 16 KB limit, a
// string at the 64 KB limit.
const SIZES = [1, 256, 16 * 1024, 64 * 1024];

// The isolation frame: Tauri's isolation.js (tauri-utils 2.10.2, src/pattern/isolation.js) reduced
// to its per-call work: hook (none), JSON body, AES-GCM encrypt, number arrays, postMessage back.
const FRAME = `<!doctype html><script>
(async () => {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["encrypt"]);
  addEventListener("message", async (event) => {
    const data = event.data;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = new TextEncoder().encode(JSON.stringify(data.payload));
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body);
    const message = Object.create(null);
    message.cmd = data.cmd; message.callback = data.callback; message.error = data.error; message.options = data.options;
    message.payload = { nonce: Array.from(iv), payload: Array.from(new Uint8Array(sealed)), contentType: "application/json" };
    parent.postMessage(message, "*");
  });
  parent.postMessage("ready", "*");
})();
</script>`;

// The main frame: per call, the work the main frame does without isolation (JSON body) versus
// with it (postMessage to the sandboxed frame, wait for the sealed message, JSON body of that).
const MAIN = `<!doctype html><body><script>
window.measure = async (sizes, calls) => {
  const frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  frame.src = "/frame";
  const ready = new Promise((r) => addEventListener("message", function f(e) { if (e.data === "ready") { removeEventListener("message", f); r(); } }));
  document.body.append(frame);
  await ready;
  const roundTrip = (msg) => new Promise((resolve) => {
    addEventListener("message", function f(e) { if (e.source === frame.contentWindow) { removeEventListener("message", f); resolve(e.data); } });
    frame.contentWindow.postMessage(msg, "*");
  });
  const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const out = [];
  for (const size of sizes) {
    const msg = { cmd: "lecture_apply_edits", callback: 1, error: 2, options: {}, payload: { lecture: "l-1", edits: [{ from: 1200, to: 1200, insert: "x".repeat(size) }] } };
    const base = [], iso = [];
    let plainBytes = 0, sealedBytes = 0;
    for (let i = 0; i < calls + 50; i++) {
      let t = performance.now();
      const body = JSON.stringify(msg.payload);
      const b = performance.now() - t;
      t = performance.now();
      const sealed = await roundTrip(msg);
      const sealedBody = JSON.stringify(sealed.payload);
      const s = performance.now() - t;
      if (i >= 50) { base.push(b); iso.push(s); plainBytes = body.length; sealedBytes = sealedBody.length; }
    }
    // Whole-batch means: the browser coarsens performance.now() to 0.1 ms, too coarse per call.
    let t = performance.now();
    for (let i = 0; i < calls; i++) JSON.stringify(msg.payload);
    const baseMean = (performance.now() - t) / calls;
    t = performance.now();
    for (let i = 0; i < calls; i++) JSON.stringify((await roundTrip(msg)).payload);
    const isoMean = (performance.now() - t) / calls;
    out.push({ size, plainBytes, sealedBytes, baseMean, isoMean, base: { p50: pct(base, 0.5), p99: pct(base, 0.99) }, iso: { p50: pct(iso, 0.5), p99: pct(iso, 0.99) } });
  }
  return out;
};
</script>`;

// The Rust side of an isolated call: parse the sealed JSON (number arrays) and AES-256-GCM
// decrypt (tauri-utils isolation.rs). Measured with Node's JSON.parse and OpenSSL as a stand-in
// for serde_json and RustCrypto's aes-gcm (both AES-NI); see README.
function coreSide(size) {
  const key = randomBytes(32);
  const body = Buffer.from(JSON.stringify({ lecture: "l-1", edits: [{ from: 1200, to: 1200, insert: "x".repeat(size) }] }));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([c.update(body), c.final(), c.getAuthTag()]);
  const wire = JSON.stringify({ nonce: [...iv], payload: [...sealed], contentType: "application/json" });
  const times = [];
  for (let i = 0; i < CALLS + 50; i++) {
    const t = performance.now();
    const raw = JSON.parse(wire);
    const bytes = Buffer.from(raw.payload);
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(raw.nonce));
    d.setAuthTag(bytes.subarray(bytes.length - 16));
    const plain = Buffer.concat([d.update(bytes.subarray(0, bytes.length - 16)), d.final()]);
    if (plain.length !== body.length) throw new Error("decrypt mismatch");
    if (i >= 50) times.push(performance.now() - t);
  }
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  times.sort((a, b) => a - b);
  return { mean, p50: times[Math.floor(0.5 * times.length)], p99: times[Math.floor(0.99 * times.length)] };
}

const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.url === "/frame" ? FRAME : MAIN);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const f = (n) => n.toFixed(3).padStart(8);
try {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch();
    const page = await browser.newPage();
    await page.goto(url);
    const rows = await page.evaluate(([s, n]) => window.measure(s, n), [SIZES, CALLS]);
    const version = browser.version();
    await browser.close();
    console.log(`\n${engine} ${version}: ${CALLS} calls per size, ms per call (main-thread work + frame hop)`);
    console.log("  insert B   JSON B  sealed B | plain mean  plain p99 |   iso mean    iso p99 | core mean core p99 | added mean added p99");
    for (const r of rows) {
      const core = coreSide(r.size);
      const added = r.iso.p99 - r.base.p99 + core.p99;
      const addedMean = r.isoMean - r.baseMean + core.mean;
      console.log(
        `${String(r.size).padStart(10)} ${String(r.plainBytes).padStart(8)} ${String(r.sealedBytes).padStart(9)} | ${f(r.baseMean)}   ${f(r.base.p99)} |   ${f(r.isoMean)}   ${f(r.iso.p99)} | ${f(core.mean)}  ${f(core.p99)} |   ${f(addedMean)} ${f(added)}`,
      );
    }
  }
} finally {
  server.close();
}
