// F-028 spike: the parent page of the figure-frame harness (spikes/figure-frame/README.md). It
// stores secrets the frame must not see, checks that Tauri's IPC answers it (the control), then
// opens three probe frames with `sandbox="allow-scripts"`: `fig` loads its probe from the frame
// origin (standing in for lecter-fig:) and `lib` from the lib origin (lecter-lib:), each under the
// spec's CSP with its stand-in named; `bare` has no CSP, so its network results (observed, not
// graded) show what the app's native request filter stops on its own. The app reports whether it
// armed that filter in this page's query (`ff-filter`, app/src/figure_filter/arm.rs). It grades
// what the probes report (pages/probe.js) and runs the in-page leg of the busy-frame watchdog:
// a ping to each frame every HEARTBEAT_MS, a frame flagged busy once its last pong is STALE_MS old.
// Drivers (the e2e flow, measure.mjs) call window.__ff.
(() => {
  const HEARTBEAT_MS = 250;
  const STALE_MS = 1500;
  const CHECK_MS = 100;
  const LOAD_MS = 5000;
  const RESULT_MS = 20000;
  const SECRET = "parent-storage-secret";
  const params = new URL(location.href).searchParams;
  const expectTauri = params.get("tauri") === "1";
  const filter = {
    state: params.get("ff-filter"),
    kind: params.get("ff-filter-kind"),
    error: params.get("ff-filter-error"),
  };
  const variants = ["fig", "lib", "bare"];
  /** The frames under the spec's CSP; `bare` is only observed. */
  const graded = new Set(["fig", "lib"]);
  const BEACONS = {
    fetch: "fetch",
    "fetch no-cors": "fetch-nocors",
    xhr: "xhr",
    sendBeacon: "sendbeacon",
    websocket: "websocket",
    eventsource: "eventsource",
    image: "image",
    "css background": "css",
    "link prefetch": "prefetch",
    "link preload image": "preload-image",
    "link preload fetch": "preload-fetch",
    "link stylesheet": "stylesheet",
    "nested iframe": "iframe",
    "window.open": "open",
  };

  const ff = {
    started: Date.now(),
    control: { done: false, ipc: null, beacon: false },
    frames: {},
    warns: [],
    flags: [],
    ticks: [],
    hits: null,
    hitsAt: 0,
    navigatedAt: 0,
  };
  window.__ff = ff;
  window.ffSecret = "parent-global-secret";

  // Tauri answers a call whose callback the page doesn't know with this warning (core.js): an
  // answer to a frame's call lands here, because the core evaluates answers in the main frame.
  for (const level of ["warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const text = args.map(String).join(" ");
      if (/Couldn't find callback id/.test(text)) ff.warns.push({ at: Date.now(), text: text.slice(0, 200) });
      original(...args);
    };
  }

  try {
    localStorage.setItem("ff-secret", SECRET);
    sessionStorage.setItem("ff-secret", SECRET);
    localStorage.removeItem("ff-frame");
    sessionStorage.removeItem("ff-frame");
  } catch (_) {
    // Graded below: the parent-side storage checks report what the parent can read.
  }
  document.cookie = `ff-secret=${SECRET}; path=/`;
  document.cookie = "ff-frame=; path=/; max-age=0";

  const timeout = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));

  async function control() {
    const internals = window.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === "function") {
      ff.control.ipc = await Promise.race([
        internals.invoke("app_info").then(
          (v) => `resolved ${JSON.stringify(v).slice(0, 120)}`,
          (e) => `rejected ${String(e && e.message ? e.message : e).slice(0, 160)}`,
        ),
        timeout(3000, "no answer"),
      ]);
    } else {
      ff.control.ipc = "no __TAURI_INTERNALS__ in the parent";
    }
    try {
      const r = await fetch("/beacon/control-fetch");
      ff.control.beacon = r.status === 204;
    } catch (_) {
      ff.control.beacon = false;
    }
    ff.control.done = true;
  }

  function openFrames() {
    const box = document.getElementById("frames");
    for (const v of variants) {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts");
      f.title = `probe ${v}`;
      f.width = "240";
      f.height = "120";
      f.src = `/frame/probe.html?v=${v}`;
      ff.frames[v] = { el: f, opened: Date.now(), loaded: null, result: null, lastPong: 0, pongs: 0 };
      box.append(f);
    }
  }

  window.addEventListener("message", (e) => {
    const msg = e.data || {};
    const fr = ff.frames[msg.variant];
    if (!fr || e.source !== fr.el.contentWindow) return;
    if (msg.type === "loaded") fr.loaded = { at: Date.now(), origin: msg.origin, eventOrigin: e.origin };
    if (msg.type === "result") fr.result = msg.result;
    if (msg.type === "pong") {
      fr.lastPong = Date.now();
      fr.pongs += 1;
    }
    if (msg.type === "busy-start") fr.busyStart = msg.at;
    if (msg.type === "busy-end") fr.busyEnd = msg.at;
    if (msg.type === "navigate-tried") fr.navigateTried = msg.at;
  });

  let n = 0;
  setInterval(() => {
    n += 1;
    for (const fr of Object.values(ff.frames)) {
      if (fr.loaded && !fr.gone) fr.el.contentWindow.postMessage({ type: "ping", n }, "*");
    }
  }, HEARTBEAT_MS);
  setInterval(() => {
    const now = Date.now();
    ff.ticks.push(now);
    if (ff.ticks.length > 3000) ff.ticks.shift();
    for (const [v, fr] of Object.entries(ff.frames)) {
      if (!fr.loaded || fr.gone || fr.lastPong === 0) continue;
      const stale = now - fr.lastPong > STALE_MS;
      if (stale && !fr.stale) ff.flags.push({ variant: v, at: now, lastPong: fr.lastPong });
      fr.stale = stale;
    }
  }, CHECK_MS);

  /** True once the control ran and every frame reported or timed out. */
  ff.settled = () => {
    if (!ff.control.done) return false;
    const now = Date.now();
    return Object.values(ff.frames).every(
      (fr) => fr.result || (!fr.loaded && now - fr.opened > LOAD_MS) || now - fr.opened > RESULT_MS,
    );
  };

  /** Re-reads the server's beacon log into ff.hits. */
  ff.refreshHits = () => {
    const asked = Date.now();
    fetch("/hits")
      .then((r) => r.json())
      .then((hits) => {
        ff.hits = hits;
        ff.hitsAt = asked;
      })
      .catch(() => undefined);
    return asked;
  };

  /** Starts a busy loop of `ms` in one frame. */
  ff.busy = (v, ms) => {
    const fr = ff.frames[v];
    fr.busyAsked = Date.now();
    fr.el.contentWindow.postMessage({ type: "busy", ms }, "*");
    return fr.busyAsked;
  };

  /** The in-page watchdog's view of the busy loop in frame `v`. */
  ff.watch = (v) => {
    const fr = ff.frames[v];
    const start = fr.busyStart ?? fr.busyAsked ?? 0;
    const flag = ff.flags.find((f) => f.variant === v && f.at >= start);
    const end = fr.busyEnd ?? Date.now();
    let maxGap = 0;
    for (let i = 1; i < ff.ticks.length; i += 1) {
      if (ff.ticks[i] >= start && ff.ticks[i - 1] <= end) maxGap = Math.max(maxGap, ff.ticks[i] - ff.ticks[i - 1]);
    }
    return {
      busyAsked: fr.busyAsked ?? null,
      busyStart: fr.busyStart ?? null,
      busyEnd: fr.busyEnd ?? null,
      flaggedAt: flag ? flag.at : null,
      maxGap,
      pongs: fr.pongs,
    };
  };

  /** Asks every frame to submit a form and navigate itself to a beacon (the last step). */
  ff.navigateTest = () => {
    ff.navigatedAt = Date.now();
    for (const fr of Object.values(ff.frames)) {
      if (fr.loaded) fr.el.contentWindow.postMessage({ type: "navigate" }, "*");
      fr.gone = true;
    }
    return ff.navigatedAt;
  };

  const empty = (r) => !r.threw && ["undefined", "null", "", "false", "(no answer)"].includes(r.value);
  const leaks = (r) => /secret/.test(r.value);

  /**
   * Grades everything so far into `FRAME <webview> <scope> <area> <check>: ok|FAIL|observed (...)`
   * lines. `final` adds the navigation beacons (after navigateTest).
   */
  ff.grade = (webview, final) => {
    const lines = [];
    const failed = [];
    const hits = ff.hits || [];
    const line = (scope, area, check, verdict, detail) => {
      const text = `FRAME ${webview} ${scope} ${area} ${check}: ${verdict} (${JSON.stringify(detail)})`;
      lines.push(text);
      if (verdict === "FAIL") failed.push(text);
    };
    const check = (scope, area, name, ok, detail) => line(scope, area, name, ok ? "ok" : "FAIL", detail);
    const note = (scope, area, name, detail) => line(scope, area, name, "observed", detail);

    check(
      "harness",
      "control",
      "beacon log records requests",
      ff.control.beacon && hits.includes("/beacon/control-fetch"),
      ff.control.beacon,
    );
    const parentIpcAnswers = /^(resolved|rejected)/.test(String(ff.control.ipc));
    if (expectTauri) check("harness", "control", "Tauri IPC answers the parent", parentIpcAnswers, ff.control.ipc);
    else note("harness", "control", "Tauri IPC answers the parent", ff.control.ipc);
    const ran = variants.filter((v) => ff.frames[v] && ff.frames[v].result);
    check("harness", "control", "a probe ran in a sandboxed frame", ran.length > 0, { ran });
    // In the app the filter must be armed, or the network checks would prove the CSP alone.
    if (expectTauri) check("harness", "filter", "native request filter armed", filter.state === "armed", filter);
    else note("harness", "filter", "native request filter armed", filter);
    // A request that got out: the beacon log has it, or the call itself got an answer.
    const reached = (path, res) => hits.includes(path) || /^(status|type) /.test(res.value);

    for (const v of variants) {
      const fr = ff.frames[v];
      if (!fr) continue;
      // Both CSP frames must run (D-145: the CSP names the scheme, which every webview matches).
      const verdict = (scope, area, name, ok, detail) =>
        graded.has(v) ? check(scope, area, name, ok, detail) : note(scope, area, name, { blocked: ok, ...detail });
      const loaded = (ok, detail) =>
        graded.has(v) ? check(v, "load", "probe script ran", ok, detail) : note(v, "load", "probe script ran", detail);
      if (!fr.result) {
        loaded(false, { loaded: Boolean(fr.loaded), result: false });
        continue;
      }
      const r = fr.result;
      loaded(true, {
        selfOrigin: r.selfOrigin,
        eventOrigin: fr.loaded && fr.loaded.eventOrigin,
        referrer: r.referrer,
      });
      check(
        v,
        "load",
        "frame origin is opaque",
        r.selfOrigin === "null" && fr.loaded.eventOrigin === "null",
        r.selfOrigin,
      );
      for (const [name, res] of Object.entries(r.network)) {
        const path = `/beacon/${v}-${BEACONS[name]}`;
        verdict(v, "network", name, !reached(path, res), { hit: hits.includes(path), ...res });
      }
      for (const [name, res] of Object.entries(r.ownOrigin || {})) {
        const path = `/beacon/${v}-own-prefetch`;
        note(v, "own-origin", name, { reached: reached(path, res), hit: hits.includes(path), ...res });
      }
      if (final) {
        for (const name of ["form", "navigate"]) {
          const hit = hits.includes(`/beacon/${v}-${name}`);
          verdict(v, "network", name, !hit, { hit, tried: Boolean(fr.navigateTried) });
        }
      }
      if (!graded.has(v)) continue;
      for (const [name, res] of Object.entries(r.parent))
        check(v, "parent", name, (res.threw || empty(res)) && !leaks(res), res);
      for (const [name, res] of Object.entries(r.storage)) {
        const ok =
          name === "cookie" ? !/ff-secret|ff-frame=1/.test(res.value) : res.threw || res.value === "(no answer)";
        check(v, "storage", name, ok && !leaks(res), res);
      }
      note(v, "ipc", "what of the IPC exists in the frame", r.presence);
      for (const [name, res] of Object.entries(r.ipc)) {
        const ok = name.startsWith("fetch") ? res.threw : !/^resolved/.test(res.value);
        check(v, "ipc", name, ok, res);
      }
      const stray = ff.warns.filter((w) => w.at >= r.ipcAt);
      check(v, "ipc", "no Tauri answer to the frame's calls", stray.length === 0, {
        stray,
        parentIpc: parentIpcAnswers,
      });
      note(v, "csp", "violations", r.violations);
    }
    let wrote = "";
    try {
      wrote = `localStorage ${localStorage.getItem("ff-frame")}; sessionStorage ${sessionStorage.getItem("ff-frame")}`;
    } catch (e) {
      wrote = String(e);
    }
    check(
      "harness",
      "storage",
      "parent sees no frame write",
      wrote === "localStorage null; sessionStorage null" && !/ff-frame=1/.test(document.cookie),
      { wrote, cookie: document.cookie },
    );
    const late = hits.filter(
      (h) => h !== "/beacon/control-fetch" && !variants.some((v) => h.startsWith(`/beacon/${v}-`)),
    );
    check("harness", "network", "no unexpected request", late.length === 0, late);
    return { lines, failed };
  };

  control().then(openFrames);
})();
