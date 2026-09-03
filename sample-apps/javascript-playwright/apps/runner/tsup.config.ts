import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "javascript-worker": "../../packages/runner-core/src/javascript-worker.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  external: [
    "playwright",
    "playwright-core",
    "chromium-bidi/lib/cjs/bidiMapper/BidiMapper",
    "chromium-bidi/lib/cjs/cdp/CdpConnection",
  ],
  noExternal: [
    "@cua-sample/replay-schema",
    "@cua-sample/runner-core",
    "@cua-sample/browser-runtime",
    "@cua-sample/scenario-kit",
  ],
});
