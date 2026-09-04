import childProcess from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";

const { chromium } = createRequire(new URL("../../../../../javascript-app/apps/runner/package.json", import.meta.url))("playwright") as typeof import("playwright");

import { createServer } from "../../../../../javascript-app/apps/runner/src/server.js";

// Observe real child lifetimes without replacing the worker or browser backend.
const fork = childProcess.fork;
childProcess.fork = ((...args: Parameters<typeof fork>) => {
  const child = fork(...args);
  process.send?.({ type: "owned-process", kind: "worker", pid: child.pid });
  return child;
}) as typeof fork;
syncBuiltinESMExports();

const launchServer = chromium.launchServer.bind(chromium);
chromium.launchServer = async (...args) => {
  const browser = await launchServer(...args);
  process.send?.({ type: "owned-process", kind: "browser", pid: browser.process().pid });
  return browser;
};

const dataRoot = process.env.CUA_TEST_DATA_ROOT;
if (!dataRoot) throw new Error("CUA_TEST_DATA_ROOT is required.");
const app = createServer({ dataRoot, stepDelayMs: 0 });
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void app.close().then(() => process.exit(0), (error: unknown) => {
    console.error(error);
    process.exit(1);
  });
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
process.on("disconnect", close);

const address = await app.listen({ host: "127.0.0.1", port: 0 });
process.send?.({ type: "ready", address });
