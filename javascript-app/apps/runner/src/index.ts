import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4001);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer();
let shuttingDown = false;
const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
for (const [signal, exitCode] of Object.entries(signalExitCodes)) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.close().then(
      () => process.exit(exitCode),
      (error: unknown) => {
        console.error("Runner shutdown failed:", error);
        process.exit(1);
      },
    );
  });
}

try {
  await server.listen({ port, host });
  console.log(`Runner listening on http://${host}:${port}`);
} catch (error) {
  console.error("Runner failed to start:", error);
  process.exit(1);
}
