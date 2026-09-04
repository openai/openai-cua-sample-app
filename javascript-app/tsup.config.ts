import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "javascript-worker": "src/javascript-worker.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  external: ["playwright"],
  noExternal: ["@cua-sample/contracts"],
});
