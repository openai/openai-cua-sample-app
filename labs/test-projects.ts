import { fileURLToPath } from "node:url";

export function runtimeProject(runtime: "javascript" | "python", live = false) {
  const appRoot = fileURLToPath(new URL(`../${runtime}-app/`, import.meta.url));
  const aliases = Object.fromEntries(["replay-schema", "scenario-kit", "browser-runtime", "runner-core"].map(name => [
    `@cua-sample/${name}`, `${appRoot}packages/${name}/src/index.ts`,
  ]));
  return {
    resolve: { alias: { ...aliases, "@app/runner-core": `${appRoot}packages/runner-core/src`, openai: `${appRoot}packages/runner-core/node_modules/openai` } },
    test: {
      name: runtime,
      ...(live ? {} : { env: { CUA_RESPONSES_MODE: "fallback" } }),
      include: [`tests/${live ? "live" : "integration"}/${runtime}/**/*.test.{js,ts}`],
      fileParallelism: false,
      testTimeout: live ? 130_000 : 15_000,
      hookTimeout: 30_000,
    },
  };
}
