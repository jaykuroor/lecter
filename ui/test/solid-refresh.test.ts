// @vitest-environment node
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

// CI-c1493e7: under Vitest, solid-refresh imported the `/@solid-refresh` virtual
// module, which Windows turned into an invalid file URL. Tests must not get HMR;
// the dev server must keep it.
const root = fileURLToPath(new URL("..", import.meta.url));
let server: ViteDevServer | undefined;

async function transformApp(mode: string): Promise<string> {
  server = await createServer({
    root,
    mode,
    configFile: `${root}vite.config.ts`,
    logLevel: "silent",
    server: { middlewareMode: true, ws: false },
  });
  const result = await server.transformRequest("/src/App.tsx");
  return result?.code ?? "";
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("solid-refresh injection", () => {
  it("is off in test mode", async () => {
    expect(await transformApp("test")).not.toContain("solid-refresh");
  });

  it("stays on for the dev server", async () => {
    expect(await transformApp("development")).toContain("solid-refresh");
  });
});
