import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    environmentMatchGlobs: [
      ["src/test/**/*.test.ts", "node"],
    ],
    setupFiles: ["./webview-src/test/setup.ts"],
    include: [
      "webview-src/**/*.test.{ts,tsx}",
      "src/test/**/*.test.ts",
    ],
    exclude: ["out", "dist", "node_modules", "**/test/suite/**"],
  },
});
