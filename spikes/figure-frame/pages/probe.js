// F-028 spike: runs inside the sandboxed figure frame (`sandbox="allow-scripts"`, the CSP of
// 08-figures.md#sandbox-pages, the app's native request filter below) and tries everything a
// figure must not be able to do: reach the network, read the parent, use storage, call Tauri's IPC. Each attempt is reported raw to the
// harness (pages/harness.js), which grades it. The frame also answers the watchdog's pings and,
// on request, runs a bounded busy loop. Plain script: the CSP allows no inline code and no eval.
(() => {
  const variant = document.body.dataset.variant || "unknown";
  // The network stand-in: an origin that is neither the frame's nor the lib's (server.ts).
  const netOrigin = document.body.dataset.net || new URL(location.href).origin;
  const post = (msg) => parent.postMessage({ ...msg, variant }, "*");
  const violations = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    violations.push(`${e.effectiveDirective || e.violatedDirective} ${e.blockedURI}`);
  });

  const beacon = (name) => `${netOrigin}/beacon/${variant}-${name}`;
  const describe = (e) => (e && e.name ? `${e.name}: ${e.message}` : String(e));
  const timeout = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));
  /** Runs `fn`; a throw or rejection is reported as `threw`, a value as `value`. */
  async function attempt(fn, ms = 3000) {
    try {
      const value = await Promise.race([Promise.resolve().then(fn), timeout(ms, "(no answer)")]);
      return { threw: false, value: value === undefined ? "undefined" : String(value).slice(0, 200) };
    } catch (e) {
      return { threw: true, value: describe(e) };
    }
  }
  const onEvent = (target, ok, bad) =>
    new Promise((resolve, reject) => {
      target.addEventListener(ok, () => resolve(ok));
      target.addEventListener(bad, () => reject(new Error(bad)));
    });

  // Network: every way a page can make a request without running a new script, each aimed at the
  // network origin. Scripts are left out: the CSP names only lecter-fig: and lecter-lib:, which
  // serve only bundled or hash-named files (SEC-33), so a script load never reaches the network.
  const network = {
    fetch: () => fetch(beacon("fetch")).then((r) => `status ${r.status}`),
    "fetch no-cors": () => fetch(beacon("fetch-nocors"), { mode: "no-cors" }).then((r) => `type ${r.type}`),
    xhr: () => {
      const x = new XMLHttpRequest();
      x.open("GET", beacon("xhr"));
      x.send();
      return onEvent(x, "load", "error").then(() => `status ${x.status}`);
    },
    sendBeacon: () => {
      const queued = navigator.sendBeacon(beacon("sendbeacon"), "x");
      if (!queued) throw new Error("sendBeacon returned false");
      return "queued";
    },
    websocket: () => onEvent(new WebSocket(beacon("websocket").replace(/^http/, "ws")), "open", "error"),
    eventsource: () => onEvent(new EventSource(beacon("eventsource")), "open", "error"),
    image: () => {
      const img = new Image();
      img.src = beacon("image");
      return onEvent(img, "load", "error");
    },
    "css background": () => {
      const div = document.createElement("div");
      div.style.cssText = `width:4px;height:4px;background-image:url("${beacon("css")}")`;
      document.body.append(div);
      return timeout(1000, "(no error event for CSS)");
    },
    "link prefetch": () => {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = beacon("prefetch");
      document.head.append(link);
      return onEvent(link, "load", "error");
    },
    "link preload image": () => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = beacon("preload-image");
      document.head.append(link);
      return onEvent(link, "load", "error");
    },
    "link preload fetch": () => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "fetch";
      link.crossOrigin = "anonymous";
      link.href = beacon("preload-fetch");
      document.head.append(link);
      return onEvent(link, "load", "error");
    },
    "link stylesheet": () => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = beacon("stylesheet");
      document.head.append(link);
      return onEvent(link, "load", "error");
    },
    "nested iframe": () => {
      const f = document.createElement("iframe");
      f.src = beacon("iframe");
      document.body.append(f);
      return timeout(1000, "(no load event)");
    },
    "window.open": () => {
      const w = window.open(beacon("open"), "_blank");
      if (w === null) throw new Error("window.open returned null");
      return "a window opened";
    },
  };

  // Observed only: a prefetch to the frame's own URL origin (the stand-in for lecter-fig:, which the
  // filter lets through). CI run 41461890948 saw WebView2 send it despite the CSP; in the app that
  // origin serves only hash-named files (SEC-33), so it isn't the network.
  const ownOrigin = {
    "link prefetch": () => {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = `${new URL(location.href).origin}/beacon/${variant}-own-prefetch`;
      document.head.append(link);
      return onEvent(link, "load", "error");
    },
  };

  // The parent: its DOM, its globals, its location.
  const parentReads = {
    "parent.document": () => parent.document.getElementById("secret").textContent,
    "top.document": () => top.document.title,
    "window.frameElement": () => window.frameElement && window.frameElement.outerHTML,
    "parent global": () => parent.ffSecret,
    "parent.location.href": () => parent.location.href,
  };

  // Storage: reading what the parent's origin stored, and keeping anything of our own.
  const storage = {
    localStorage: () => {
      const seen = localStorage.getItem("ff-secret");
      localStorage.setItem("ff-frame", "1");
      return `read ${seen}; wrote ${localStorage.getItem("ff-frame")}`;
    },
    sessionStorage: () => {
      const seen = sessionStorage.getItem("ff-secret");
      sessionStorage.setItem("ff-frame", "1");
      return `read ${seen}; wrote ${sessionStorage.getItem("ff-frame")}`;
    },
    cookie: () => {
      const before = document.cookie;
      document.cookie = "ff-frame=1; path=/";
      return `read "${before}"; after write "${document.cookie}"`;
    },
    indexedDB: () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("ff-frame");
        req.onsuccess = () => resolve("opened");
        req.onerror = () => reject(req.error || new Error("error"));
      }),
    caches: () => caches.open("ff-frame").then(() => "opened"),
    "storage.getDirectory": () => navigator.storage.getDirectory().then(() => "opened"),
  };

  // IPC: what of Tauri's IPC exists in here, and whether a call gets out.
  function ipcPresence() {
    const internals = window.__TAURI_INTERNALS__;
    return {
      __TAURI_INTERNALS__: typeof internals,
      invoke: typeof (internals && internals.invoke),
      __TAURI__: typeof window.__TAURI__,
      "window.ipc": typeof (window.ipc && window.ipc.postMessage),
      "webkit.messageHandlers.ipc": typeof (
        window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.ipc
      ),
      "chrome.webview": typeof (window.chrome && window.chrome.webview && window.chrome.webview.postMessage),
    };
  }
  /** Callback ids no real page would pick: a Tauri answer to them shows up in the parent. */
  const RAW_CALLBACK = 3141592;
  const RAW_ERROR = 2718281;
  const ipc = {
    "fetch ipc://localhost": () =>
      fetch("ipc://localhost/app_info", { method: "POST", body: "{}" }).then((r) => `status ${r.status}`),
    "fetch http://ipc.localhost": () =>
      fetch("http://ipc.localhost/app_info", { method: "POST", body: "{}" }).then((r) => `status ${r.status}`),
    "__TAURI_INTERNALS__.invoke": () => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== "function") throw new Error("no invoke in the frame");
      return internals.invoke("app_info").then((v) => `resolved ${JSON.stringify(v)}`);
    },
    "raw postMessage": () => {
      const body = JSON.stringify({
        cmd: "app_info",
        callback: RAW_CALLBACK,
        error: RAW_ERROR,
        payload: {},
        options: {},
        __TAURI_INVOKE_KEY__: "not-the-key",
      });
      const channels = [
        window.ipc && window.ipc.postMessage && ((m) => window.ipc.postMessage(m)),
        window.webkit?.messageHandlers?.ipc && ((m) => window.webkit.messageHandlers.ipc.postMessage(m)),
        window.chrome?.webview?.postMessage && ((m) => window.chrome.webview.postMessage(m)),
      ].filter(Boolean);
      if (channels.length === 0) throw new Error("no native IPC channel in the frame");
      for (const send of channels) send(body);
      return `posted on ${channels.length} channel(s)`;
    },
  };

  async function run(table) {
    const out = {};
    for (const [name, fn] of Object.entries(table)) out[name] = await attempt(fn);
    return out;
  }

  // The watchdog's heartbeat and the busy loop. The loop is bounded so the app always recovers,
  // even in a webview that runs the frame on the parent's thread.
  window.addEventListener("message", (e) => {
    const msg = e.data || {};
    if (e.source !== parent) return;
    if (msg.type === "ping") post({ type: "pong", n: msg.n, at: Date.now() });
    if (msg.type === "busy") {
      const start = Date.now();
      post({ type: "busy-start", at: start });
      let spins = 0;
      while (Date.now() - start < msg.ms) spins += 1;
      post({ type: "busy-end", at: Date.now(), spins });
    }
    if (msg.type === "navigate") {
      post({ type: "navigate-tried", at: Date.now() });
      const form = document.createElement("form");
      form.action = beacon("form");
      form.method = "GET";
      document.body.append(form);
      try {
        form.submit();
      } catch (_) {
        // Reported by the beacon log.
      }
      location.href = beacon("navigate");
    }
  });

  post({ type: "loaded", origin: String(self.origin), ua: navigator.userAgent });
  (async () => {
    const result = {
      selfOrigin: String(self.origin),
      referrer: document.referrer,
      network: await run(network),
      ownOrigin: await run(ownOrigin),
    };
    // The bare frame (no CSP) shows what the native filter stops on its own: network only.
    if (variant !== "bare") {
      result.parent = await run(parentReads);
      result.storage = await run(storage);
      result.presence = ipcPresence();
      result.ipcAt = Date.now();
      result.ipc = await run(ipc);
    }
    // Late violation events (CSS, prefetch) arrive after the attempts.
    await timeout(500);
    result.violations = violations.slice(0, 50);
    post({ type: "result", result });
  })();
})();
