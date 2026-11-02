// F-028 spike: the local web server behind the figure-frame harness (spikes/figure-frame/README.md).
// The flow tests/e2e/flows/figure-frame.ts and measure.mjs import it.
//
// One server (the "page" origin) serves the harness page, the sandboxed probe frame and the
// beacon endpoint; a second one on another port (the "lib" origin) stands in for `lecter-lib:`,
// which the app doesn't serve yet (F-141). Every request under /beacon/ is recorded and answered
// 204 with `Access-Control-Allow-Origin: *`, so a request the sandbox or the CSP lets through
// reaches the log and succeeds, and the harness reads the log at /hits.
//
// Node built-ins only (flows have no node_modules; tests/CLAUDE.md).

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The figure frame's CSP, exactly as 08-figures.md#sandbox-pages gives it. */
export const FRAME_CSP = "default-src 'none'; script-src 'self' lecter-lib:; style-src 'unsafe-inline'; img-src data:";

/** The busy-frame watchdog's tick and staleness limit (README "Watchdog"). */
export const HEARTBEAT_MS = 250;
export const STALE_MS = 1500;
/** Criterion 2: a busy frame is detected within this long after its loop starts. */
export const DETECT_BUDGET_MS = 2000;

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

/** The probe frame's CSP per variant: `self` is the spec's exact CSP; `lib` adds the lib origin. */
export function frameCsp(variant: "self" | "lib", lib: string): string {
  return variant === "self" ? FRAME_CSP : FRAME_CSP.replace("lecter-lib:", `lecter-lib: ${lib}`);
}

export type Harness = {
  /** The harness page's URL (open it in the webview under test). */
  url: string;
  page: string;
  lib: string;
  /** Every beacon path requested so far, in order. */
  hits: string[];
  close(): Promise<void>;
};

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

function probeHtml(variant: "self" | "lib", lib: string): string {
  const src = variant === "self" ? "/frame/probe.js" : `${lib}/lib/probe.js`;
  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><title>probe ${variant}</title></head>`,
    `<body data-variant="${variant}" data-lib="${lib}"><p>figure probe</p>`,
    `<script src="${src}"></script>`,
    "</body></html>",
  ].join("\n");
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

/** Starts both servers on free loopback ports. */
export async function startHarness(): Promise<Harness> {
  const hits: string[] = [];
  const origins = { page: "", lib: "" };
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

  const page = createServer((req, res) => {
    if (record(req, res)) return;
    const url = new URL(req.url ?? "/", origins.page);
    const variant = url.searchParams.get("v") === "lib" ? "lib" : "self";
    switch (url.pathname) {
      case "/harness.html":
        res.writeHead(200, { ...HTML, "content-security-policy": harnessCsp(origins.page) });
        res.end(harnessHtml());
        return;
      case "/harness.js":
        res.writeHead(200, SCRIPT);
        res.end(asset("harness.js"));
        return;
      case "/frame/probe.html":
        res.writeHead(200, { ...HTML, "content-security-policy": frameCsp(variant, origins.lib) });
        res.end(probeHtml(variant, origins.lib));
        return;
      case "/frame/probe.js":
        res.writeHead(200, SCRIPT);
        res.end(asset("probe.js"));
        return;
      case "/hits":
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(hits));
        return;
      default:
        res.writeHead(404, HTML);
        res.end("not found");
    }
  });
  const lib = createServer((req, res) => {
    if (record(req, res)) return;
    if ((req.url ?? "").split("?")[0] === "/lib/probe.js") {
      res.writeHead(200, SCRIPT);
      res.end(asset("probe.js"));
      return;
    }
    res.writeHead(404, HTML);
    res.end("not found");
  });
  // A WebSocket handshake is an HTTP upgrade: record it, then drop the socket.
  for (const s of [page, lib]) {
    s.on("upgrade", (req, socket) => {
      record(req, null);
      socket.destroy();
    });
  }

  origins.page = `http://127.0.0.1:${await listen(page)}`;
  origins.lib = `http://127.0.0.1:${await listen(lib)}`;
  return {
    url: `${origins.page}/harness.html`,
    page: origins.page,
    lib: origins.lib,
    hits,
    close: async () => {
      await Promise.all([stop(page), stop(lib)]);
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
 */
export async function watchOutOfPage(ping: () => Promise<unknown>, durationMs: number): Promise<OutOfPage> {
  const end = Date.now() + durationMs;
  const out: OutOfPage = { detectedAt: null, maxPingMs: 0 };
  while (Date.now() < end) {
    const sent = Date.now();
    let back = false;
    const answer = ping().then(
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
