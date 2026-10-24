import { render } from "solid-js/web";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

// `pnpm run dev` in a plain browser has no Tauri IPC: serve the mocked core instead. Dev builds
// only (the import is dropped from production builds), and never when a core is present (the
// Tauri webview, or a Playwright test that installed its own mock first).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const [{ installMockCore }, { defaultFixture }] = await Promise.all([
    import("../e2e/mock-core/install"),
    import("../e2e/mock-core/fixture"),
  ]);
  installMockCore(defaultFixture);
}

render(() => <App />, root);
