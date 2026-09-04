import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/shared/**/*.test.{js,ts}", "tests/integration/**/*.test.ts"],
    env: { OPENAI_API_KEY: "" },
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
