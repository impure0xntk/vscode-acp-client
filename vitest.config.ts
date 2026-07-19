import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./webview-src/test/setup.ts"],
    include: ["webview-src/**/*.test.{ts,tsx}"],
    exclude: ["out", "dist", "node_modules", "**/test/suite/**"],
  },
});
