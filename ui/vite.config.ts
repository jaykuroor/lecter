import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  // Vitest runs in mode "test": no solid-refresh there, because its `/@solid-refresh`
  // virtual import breaks on Windows (CI-c1493e7). The dev server keeps HMR.
  plugins: [solid({ hot: mode !== "test" })],
  clearScreen: false,
  build: { target: "es2022" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
  },
}));
