import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startWorkspaceLabServer } from "../src/workspace-lab-server.js";

const readFailure = vi.hoisted(() => ({ next: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      if (readFailure.next) {
        readFailure.next = false;
        return new Readable({
          read() {
            this.destroy(new Error("Simulated asset read failure"));
          },
        });
      }

      return actual.createReadStream(...args);
    },
  };
});

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  readFailure.next = false;
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function createServer(content: string | Buffer = "<h1>Lab</h1>") {
  const workspacePath = await mkdtemp(join(tmpdir(), "cua-lab-server-test-"));
  cleanups.push(() => rm(workspacePath, { force: true, recursive: true }));
  await writeFile(join(workspacePath, "index.html"), content);
  await mkdir(join(workspacePath, "assets"));
  const server = await startWorkspaceLabServer({ workspacePath });
  cleanups.push(server.close);
  return server;
}

function get(url: string, path = "/") {
  const target = new URL(url);

  return new Promise<{ body: string; status: number | undefined }>((resolve, reject) => {
    const req = request({ hostname: target.hostname, port: target.port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => resolve({ body, status: response.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("workspace lab asset serving", () => {
  it("serves regular files and reports missing assets", async () => {
    const server = await createServer();
    expect(await get(server.urlFor())).toEqual({ status: 200, body: "<h1>Lab</h1>" });
    expect((await get(server.urlFor(), "/missing.css")).status).toBe(404);
  });

  it.each(["/assets", "/index.html/..//"])(
    "rejects directory request %s without terminating the server",
    async (path) => {
      const server = await createServer();
      expect((await get(server.urlFor(), path)).status).toBe(404);
      expect((await get(server.urlFor())).status).toBe(200);
    },
  );

  it("contains asynchronous file read errors and keeps serving subsequent requests", async () => {
    const server = await createServer();
    readFailure.next = true;
    await expect(get(server.urlFor())).rejects.toThrow();
    expect((await get(server.urlFor())).status).toBe(200);
  });

  it("closes active slow readers and supports repeated close calls", async () => {
    const server = await createServer(Buffer.alloc(32 * 1024 * 1024, "x"));
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(server.urlFor(), resolve);
      req.on("error", reject);
      req.end();
    });
    response.on("error", () => {});
    response.pause();
    const closing = server.close();
    try {
      expect(server.close()).toBe(closing);
      const finished = await Promise.race([
        closing.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
      ]);
      expect(finished).toBe(true);
      await expect(get(server.urlFor())).rejects.toThrow();
      await expect(server.close()).resolves.toBeUndefined();
    } finally {
      response.destroy();
      await closing;
    }
  });
});
