import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  build: { target: "es2022" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
  },
});
