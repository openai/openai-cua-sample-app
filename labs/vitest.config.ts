import { defineConfig } from "vitest/config";
import { runtimeProject } from "./test-projects.js";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", include: ["tests/shared/**/*.test.{js,ts}"], fileParallelism: false, testTimeout: 15_000, hookTimeout: 30_000 } },
      runtimeProject("javascript"),
      runtimeProject("python"),
    ],
  },
});
