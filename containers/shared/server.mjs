import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";

const [language, command, ...args] = process.argv.slice(2);
const token = process.env.OPENAI_EXAMPLE_CODE_EXECUTION_TOKEN;
if (!token || token.length < 32) throw new Error("Set an execution-service token of at least 32 characters.");
if (process.env.OPENAI_API_KEY) throw new Error("Keep OPENAI_API_KEY in the API client, outside this container.");
const workerEnv = { ...process.env };
delete workerEnv.OPENAI_EXAMPLE_CODE_EXECUTION_TOKEN;
const worker = spawn(command, args, { env: workerEnv, stdio: ["pipe", "pipe", "inherit"] });
const fixture = readFileSync(new URL("./fixture.html", import.meta.url));
let sessionId;
let pending;
let ready = false;
let stopping = false;
let buffer = "";
let fixtureResult = null;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function stop(message, status = 503) {
  if (stopping) return;
  stopping = true;
  console.error(message);
  if (pending) {
    clearTimeout(pending.timer);
    json(pending.response, status, { error: `${message} Restart the container to continue.` });
    pending = undefined;
  }
  worker.kill("SIGKILL");
  // Exiting the container's main process also stops browser and desktop children.
  setTimeout(() => process.exit(1), 100);
}

function validOutput(item) {
  return item && (
    (item.type === "input_text" && typeof item.text === "string") ||
    (item.type === "input_image" && item.detail === "original" &&
      typeof item.image_url === "string" && item.image_url.startsWith("data:image/png;base64,"))
  );
}

worker.stdout.setEncoding("utf8");
worker.stdout.on("data", (chunk) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 17 * 1024 * 1024) return stop("Worker output limit exceeded.");
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      const payload = JSON.parse(line);
      if (!ready && payload.ready === true) {
        ready = true;
        server.listen(8000, "0.0.0.0", () => console.log(`${language} execution service ready on port 8000`));
      } else if (pending && Array.isArray(payload.output) && payload.output.length <= 101 && payload.output.every(validOutput)) {
        clearTimeout(pending.timer);
        json(pending.response, 200, { output: payload.output });
        pending = undefined;
        if (payload.fatal) stop("Desktop fail-safe triggered.");
      } else {
        stop("Invalid worker output.");
      }
    } catch {
      stop("Invalid worker output.");
    }
  }
});
worker.on("error", () => stop("Could not start execution worker."));
worker.on("exit", () => stop("Execution worker stopped."));
worker.stdin.on("error", () => stop("Execution worker disconnected."));

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 128 * 1024) throw new Error("Request exceeds 128 KiB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  try {
    if (stopping) return json(response, 503, { error: "Container is stopping." });
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ready, language, session_bound: sessionId !== undefined });
    }
    // This local fixture is also reachable from the browser inside the container.
    if (request.method === "GET" && request.url === "/fixture") {
      response.writeHead(200, { "content-type": "text/html" });
      return response.end(fixture);
    }
    if (request.method === "POST" && request.url === "/fixture/result") {
      const result = await readJson(request);
      fixtureResult = { name: result.name, clicks: result.clicks, wheels: result.wheels, keys: result.keys };
      return json(response, 200, { success: result.name === "Alice" && result.clicks > 0 && result.wheels > 0 });
    }
    const authorization = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (request.headers.origin || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      return json(response, 401, { error: "A bearer token is required; browser-origin requests are not supported." });
    }
    if (request.method === "GET" && request.url === "/fixture/result") return json(response, 200, fixtureResult);
    if (request.method !== "POST" || request.url !== "/execute") return json(response, 404, { error: "Use POST /execute." });
    if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
      return json(response, 415, { error: "Use application/json." });
    }
    const body = await readJson(request);
    if (!body || body.language !== language || typeof body.session_id !== "string" ||
        !body.session_id.length || body.session_id.length > 200 ||
        typeof body.code !== "string" || Buffer.byteLength(body.code) > 64 * 1024) {
      return json(response, 400, { error: "Expected { session_id, language, code }; code must be at most 64 KiB." });
    }
    if (pending) return json(response, 409, { error: "An execution is already in progress." });
    if (sessionId !== undefined && sessionId !== body.session_id) {
      return json(response, 409, { error: "One session per container. Restart it before starting another client." });
    }
    sessionId = body.session_id;
    pending = { response, timer: setTimeout(() => stop("Execution exceeded 25 seconds.", 504), 25_000) };
    worker.stdin.write(`${JSON.stringify({ code: body.code })}\n`);
  } catch (error) {
    if (!response.headersSent) json(response, 400, { error: String(error) });
  }
});
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
const startupTimer = setTimeout(() => { if (!ready) stop("Worker startup timed out."); }, 30_000);
startupTimer.unref();
