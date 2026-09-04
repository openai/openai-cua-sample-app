import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/live/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 130_000,
    hookTimeout: 30_000,
  },
});
