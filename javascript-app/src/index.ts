import { createServer } from "./server.js";
import { acquireBackendLease } from "./backend-lease.js";

const port = Number(process.env.PORT ?? 4001);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer();
let releaseLease: (() => Promise<void>) | undefined;
let shuttingDown = false;
async function shutdown() {
  try { await server.close(); }
  finally { await releaseLease?.(); }
}
const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
function beginShutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  void shutdown().then(
    () => process.exit(exitCode),
    (error: unknown) => {
      console.error("Runner shutdown failed:", error);
      process.exit(1);
    },
  );
}
for (const [signal, exitCode] of Object.entries(signalExitCodes)) {
  process.on(signal, () => beginShutdown(exitCode));
}
if (process.env.CUA_MANAGED_LAUNCH === "1") {
  // The launcher closes its private stdin pipe to request graceful cleanup.
  process.stdin.once("end", () => beginShutdown(0));
  process.stdin.resume();
}

try {
  releaseLease = await acquireBackendLease();
  await server.listen({ port, host });
  console.log(`Runner listening on http://${host}:${port}`);
} catch (error) {
  console.error("Runner failed to start:", error);
  await shutdown().catch(cleanupError => console.error("Runner cleanup failed:", cleanupError));
  process.exit(1);
}
