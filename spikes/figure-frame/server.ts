// F-028 spike: the local web servers behind the figure-frame harness (spikes/figure-frame/README.md).
// The flow tests/e2e/flows/figure-frame.ts and measure.mjs import it.
//
// Three loopback servers, three origins:
// - "page": the harness page and the sandboxed probe frames (the frame origin, standing in for
//   `lecter-fig:`; same URL origin as the parent, so only the sandbox separates them);
// - "lib": a second origin standing in for `lecter-lib:`;
// - "net": the network, outside both figure origins: every probe request aims here.
// Every request under /beacon/ (on any of them) is recorded and answered 204 with
// `Access-Control-Allow-Origin: *`, so a request the sandbox, the CSP or the native filter lets
// through reaches the log and succeeds; the harness reads the log at /hits.
//
// Node built-ins only (flows have no node_modules; tests/CLAUDE.md).

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The figure frame's CSP, exactly as 08-figures.md#sandbox-pages gives it (D-145). */
export const FRAME_CSP = "default-src 'none'; script-src lecter-fig: lecter-lib:; style-src 'unsafe-inline'; img-src data:";

/** The busy-frame watchdog's tick and staleness limit (README "Watchdog"). */
export const HEARTBEAT_MS = 250;
export const STALE_MS = 1500;
/** Criterion 2: a busy frame is detected within this long after its loop starts. */
export const DETECT_BUDGET_MS = 2000;

/** The path the app's test-hooks build arms its native request filter on (app/src/figure_filter/arm.rs). */
export const ARM_PATH = "/__lecter-test/figure-filter";

/**
 * The probe frames: `fig` loads its probe from the frame origin and `lib` from the lib origin, each
 * under the spec's CSP with its stand-in named next to the scheme; `bare` has no CSP at all, so
 * only the sandbox and the native filter stand between it and the network (observed, not graded).
 */
export type Variant = "fig" | "lib" | "bare";
export const VARIANTS: Variant[] = ["fig", "lib", "bare"];

/**
 * The harness page's CSP: the app's main-window CSP (SEC-30) with `frame-src` scoped to the probe
 * frame's folder instead of `lecter-fig:`, so a frame that navigates itself to a beacon is blocked
 * as it would be in the app. `connect-src 'self'` lets the harness read /hits.
 */
function harnessCsp(page: string): string {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self' ipc: http://ipc.localhost",
    "object-src 'none'",
    `frame-src ${page}/frame/`,
  ].join("; ");
}

/** The probe frame's CSP per variant (null: none), the stand-in origin named next to its scheme. */
export function frameCsp(variant: Variant, page: string, lib: string): string | null {
  if (variant === "bare") return null;
  return variant === "fig"
    ? FRAME_CSP.replace("lecter-fig:", `lecter-fig: ${page}`)
    : FRAME_CSP.replace("lecter-lib:", `lecter-lib: ${lib}`);
}

export type Harness = {
  /** The harness page's URL (open it in the webview under test). */
  url: string;
  page: string;
  lib: string;
  net: string;
  /** Every beacon path requested so far, in order. */
  hits: string[];
  close(): Promise<void>;
};

/**
 * The URL that arms the app's native filter and then goes on to the harness: frames may load from
 * the frame and lib origins; `pageOrigins` (the app's own, for WebView2, which can't tell a
 * frame's request from the page's) pass for the page.
 */
export function armUrl(h: Harness, pageOrigins: string[]): string {
  const q = new URLSearchParams();
  q.append("figure", h.page);
  q.append("figure", h.lib);
  for (const o of pageOrigins) q.append("page", o);
  q.append("next", `${h.url}?tauri=1`);
  return `${h.page}${ARM_PATH}?${q}`;
}

const SCRIPT = { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" };
const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

function asset(name: string): string {
  return readFileSync(join(here, "pages", name), "utf8");
}

function harnessHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>figure-frame harness</title></head>',
    "<body>",
    '<p id="secret">parent-dom-secret</p>',
    '<div id="frames"></div>',
    '<script src="/harness.js"></script>',
    "</body></html>",
  ].join("\n");
}

function probeHtml(variant: Variant, lib: string, net: string): string {
  const src = variant === "lib" ? `${lib}/lib/probe.js` : "/frame/probe.js";
  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><title>probe ${variant}</title></head>`,
    `<body data-variant="${variant}" data-net="${net}"><p>figure probe</p>`,
    `<script src="${src}"></script>`,
    "</body></html>",
  ].join("\n");
}

function variantOf(value: string | null): Variant {
  return value === "lib" || value === "bare" ? value : "fig";
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Starts the three servers on free loopback ports. */
export async function startHarness(): Promise<Harness> {
  const hits: string[] = [];
  const origins = { page: "", lib: "", net: "" };
  const record = (req: IncomingMessage, res: ServerResponse | null): boolean => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (!path.startsWith("/beacon/")) return false;
    hits.push(path);
    if (res) {
      res.writeHead(204, { "access-control-allow-origin": "*", "cache-control": "no-store" });
      res.end();
    }
    return true;
  };
  const notFound = (res: ServerResponse) => {
    res.writeHead(404, HTML);
    res.end("not found");
  };

  const page = createServer((req, res) => {
    if (record(req, res)) return;
    const url = new URL(req.url ?? "/", origins.page);
    switch (url.pathname) {
      case "/harness.html":
        res.writeHead(200, { ...HTML, "content-security-policy": harnessCsp(origins.page) });
        res.end(harnessHtml());
        return;
      case "/harness.js":
        res.writeHead(200, SCRIPT);
        res.end(asset("harness.js"));
        return;
      case "/frame/probe.html": {
        const variant = variantOf(url.searchParams.get("v"));
        const csp = frameCsp(variant, origins.page, origins.lib);
        res.writeHead(200, csp === null ? HTML : { ...HTML, "content-security-policy": csp });
        res.end(probeHtml(variant, origins.lib, origins.net));
        return;
      }
      case "/frame/probe.js":
        res.writeHead(200, SCRIPT);
        res.end(asset("probe.js"));
        return;
      case "/hits":
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(hits));
        return;
      default:
        notFound(res);
    }
  });
  const lib = createServer((req, res) => {
    if (record(req, res)) return;
    if ((req.url ?? "").split("?")[0] === "/lib/probe.js") {
      res.writeHead(200, SCRIPT);
      res.end(asset("probe.js"));
      return;
    }
    notFound(res);
  });
  const net = createServer((req, res) => {
    if (!record(req, res)) notFound(res);
  });
  // A WebSocket handshake is an HTTP upgrade: record it, then drop the socket.
  for (const s of [page, lib, net]) {
    s.on("upgrade", (req, socket) => {
      record(req, null);
      socket.destroy();
    });
  }

  origins.page = `http://127.0.0.1:${await listen(page)}`;
  origins.lib = `http://127.0.0.1:${await listen(lib)}`;
  origins.net = `http://127.0.0.1:${await listen(net)}`;
  return {
    url: `${origins.page}/harness.html`,
    ...origins,
    hits,
    close: async () => {
      await Promise.all([stop(page), stop(lib), stop(net)]);
    },
  };
}

export type OutOfPage = {
  /** When a ping first stayed unanswered for STALE_MS (epoch ms), or null. */
  detectedAt: number | null;
  /** The longest a ping took to come back, in ms. */
  maxPingMs: number;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The out-of-page leg of the watchdog: what the Rust core can see from outside the web content
 * process. Every HEARTBEAT_MS it evaluates a trivial script in the page (`ping`, a WebDriver
 * execute here, `webview.eval` in the app) and flags the page busy once one hasn't come back for
 * STALE_MS. Runs for `durationMs`, then waits for the last ping.
 *
 * `first` is the call that started the busy loop, sent just before: it is watched as the first
 * ping. In a webview that runs the frame on the page's thread that call itself only returns when
 * the loop ends (WebKitGTK and WKWebView in CI run 41461890948: 5 s), so awaiting it before
 * watching would hide the loop from this leg.
 */
export async function watchOutOfPage(
  ping: () => Promise<unknown>,
  durationMs: number,
  first?: Promise<unknown>,
): Promise<OutOfPage> {
  const end = Date.now() + durationMs;
  const out: OutOfPage = { detectedAt: null, maxPingMs: 0 };
  let next: Promise<unknown> | undefined = first;
  while (Date.now() < end) {
    const sent = Date.now();
    let back = false;
    const call = next ?? ping();
    next = undefined;
    const answer = call.then(
      () => {
        back = true;
      },
      () => {
        back = true;
      },
    );
    await Promise.race([answer, wait(STALE_MS)]);
    if (!back && out.detectedAt === null) out.detectedAt = Date.now();
    await answer;
    const took = Date.now() - sent;
    out.maxPingMs = Math.max(out.maxPingMs, took);
    if (took < HEARTBEAT_MS) await wait(HEARTBEAT_MS - took);
  }
  return out;
}
