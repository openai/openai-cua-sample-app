import { createServer } from "node:net";

// Shared with the native Python entrypoint. Never expose a per-backend override.
const backendLeasePort = 4050;

export async function acquireBackendLease(port = backendLeasePort): Promise<() => Promise<void>> {
  // A probe must not leave TIME_WAIT sockets that block Python's next bind.
  const listener = createServer(socket => socket.resetAndDestroy());
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      listener.off("error", reject);
      resolve();
    });
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      throw new Error("Another sample-app backend is running, or coordination port 4050 is occupied. Stop it before launching this backend.");
    }
    throw error;
  });
  let closing: Promise<void> | undefined;
  return () => closing ??= new Promise<void>((resolve, reject) => {
    listener.close(error => error ? reject(error) : resolve());
  });
}
