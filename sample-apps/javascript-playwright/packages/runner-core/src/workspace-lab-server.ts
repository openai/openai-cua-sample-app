import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

type WorkspaceLabServer = {
  close: () => Promise<void>;
  urlFor: (pathname?: string) => string;
};

type StartWorkspaceLabServerOptions = {
  entryPath?: string;
  host?: string;
  workspacePath: string;
};

const contentTypeByExtension = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function resolveWorkspaceAssetPath(workspacePath: string, pathname: string) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(
    workspacePath,
    `.${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`,
  );

  if (candidate !== workspacePath && !candidate.startsWith(`${workspacePath}${sep}`)) {
    throw new Error("Requested asset path escapes the workspace root.");
  }

  return candidate;
}

function getRequestPathname(request: IncomingMessage, entryPath: string) {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

  return pathname === "/" ? `/${entryPath}` : pathname;
}

function getContentType(path: string) {
  return contentTypeByExtension.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

export async function startWorkspaceLabServer(
  options: StartWorkspaceLabServerOptions,
): Promise<WorkspaceLabServer> {
  const workspacePath = resolve(options.workspacePath);
  const host = options.host ?? "127.0.0.1";
  const entryPath = options.entryPath ?? "index.html";
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const assetPath = resolveWorkspaceAssetPath(
        workspacePath,
        getRequestPathname(request, entryPath),
      );

      await access(assetPath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": getContentType(assetPath),
      });
      createReadStream(assetPath).pipe(response);
    } catch {
      response.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ error: "Lab asset not found" }));
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Workspace lab server did not bind to a TCP port.");
  }

  return {
    close: async () => {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolvePromise();
        });
      });
    },
    urlFor: (pathname = entryPath) =>
      `http://${host}:${address.port}/${pathname.replace(/^\/+/, "")}`,
  };
}
