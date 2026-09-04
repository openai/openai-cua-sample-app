import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
    "@cua-sample/scenario-kit",
  ],
});
