import { spawnSync } from "node:child_process";
import { connect, createServer } from "node:net";
import { expect, it } from "vitest";
import { acquireBackendLease } from "../src/backend-lease.js";

it("refuses an occupied lease without disturbing its owner", async () => {
  const owner = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => owner.listen(0, "127.0.0.1", resolve));
  const address = owner.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  try {
    await expect(acquireBackendLease(address.port)).rejects.toThrow("Another sample-app backend");
    expect(owner.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) => owner.close(error => error ? reject(error) : resolve()));
  }
  const release = await acquireBackendLease(address.port);
  await Promise.all([release(), release()]);
  const releaseAgain = await acquireBackendLease(address.port);
  await releaseAgain();
});

it("lets Python acquire the released port after a probe connection", async () => {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const release = await acquireBackendLease(address.port);
  try {
    await new Promise<void>((resolve, reject) => {
      const client = connect(address.port, "127.0.0.1");
      client.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") reject(error);
      });
      client.on("close", resolve);
    });
  } finally {
    await release();
  }
  const result = spawnSync("python3", ["-c", "import socket,sys; s=socket.socket(); s.bind(('127.0.0.1',int(sys.argv[1]))); s.close()", String(address.port)], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
