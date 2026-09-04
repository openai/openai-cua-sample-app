import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium, type Page } from "playwright";

export type BrowserSession = { page: Page; close: () => Promise<void> };

export async function launchBrowserSession(options: {
  browserMode: "headless";
  screenshotDir: string;
  startTarget: { kind: "remote_url"; url: string };
  workspacePath: string;
}): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(options.startTarget.url);
    return { page, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function startWorkspaceLabServer({ workspacePath }: { workspacePath: string }) {
  const root = resolve(workspacePath);
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
  const server = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const path = resolve(root, `.${name}`);
      if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      response.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Lab test server did not start.");
  return {
    urlFor: (name: string) => `http://127.0.0.1:${address.port}/${name}`,
    close: () => new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())),
  };
}

type PaintSnapshot = { paintedPixelCount: number; layers: Array<{ id: string; name: string; pixelHash: string }> };
export async function readPaintDocumentSnapshot({ page }: BrowserSession): Promise<PaintSnapshot> {
  return page.evaluate(() => (globalThis as unknown as { __paintReadDocumentSnapshot: () => Promise<PaintSnapshot> }).__paintReadDocumentSnapshot());
}
