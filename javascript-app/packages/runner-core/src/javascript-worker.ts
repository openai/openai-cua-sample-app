import vm from "node:vm";
import util from "node:util";

import {
  connectBrowserSession,
  isRecord,
  maxCodeBytes,
  maxOutputBytes,
  parseJavaScriptOutput,
  type BrowserSession,
  type JavaScriptOutput,
  type ScenarioFinalization,
  type WorkerOperation,
} from "@cua-sample/browser-runtime";
import { assertBookingOutcome, readBookingConfirmation } from "./booking-plan.js";
import { assertKanbanOutcome, readKanbanBoardState } from "./kanban-plan.js";
import { assertPaintOutcome, readPaintSaveRecord, retainPaintArtifacts } from "./paint-plan.js";

let session: BrowserSession | undefined;
let workspacePath = "";
let repl: vm.Context | undefined;
let outputs: JavaScriptOutput[] = [];
let outputBytes = 0;
let busy = false;
let closing = false;

function appendOutput(output: JavaScriptOutput) {
  outputBytes += Buffer.byteLength(JSON.stringify(output));
  if (outputBytes > maxOutputBytes - 1024) throw new Error("JavaScript output exceeds 12 MiB.");
  outputs.push(output);
}

function createRepl(browserSession: BrowserSession) {
  return vm.createContext({
    browser: browserSession.browser,
    context: browserSession.context,
    page: browserSession.page,
    Buffer,
    console: {
      log: (...values: unknown[]) => appendOutput({
        type: "input_text",
        text: util.formatWithOptions({ getters: false, maxStringLength: 2_000, showHidden: false }, ...values),
      }),
    },
    display: (image: string) => {
      if (typeof image !== "string") throw new Error("display expects a base64 image string.");
      appendOutput({
        type: "input_image",
        image_url: image.startsWith("data:image/") ? image : `data:image/png;base64,${image}`,
        detail: "original",
      });
    },
  });
}

async function execute(code: string) {
  if (typeof code !== "string" || !code.trim() || Buffer.byteLength(code) > maxCodeBytes) {
    throw new Error("JavaScript code must be nonempty and at most 64 KiB.");
  }
  outputs = [];
  outputBytes = 0;
  try {
    // The parent process enforces the deadline, including loops after an await.
    await new vm.Script(`(async () => {\n${code}\n})();`, { filename: "exec_js.js" }).runInContext(repl!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (outputBytes > maxOutputBytes - 1024) throw new Error("JavaScript output exceeds 12 MiB.");
    appendOutput({ type: "input_text", text: message.slice(0, 4_000) });
  }
  if (!outputs.length) appendOutput({ type: "input_text", text: "exec_js completed with no console output." });
  return parseJavaScriptOutput(outputs);
}

async function finalizeScenario(input: Extract<WorkerOperation, { operation: "finalize" }>): Promise<ScenarioFinalization> {
  const result: ScenarioFinalization = { notes: [], verificationPassed: false };
  const browserSession = session!;
  let verify: () => Promise<string>;
  switch (input.scenarioId) {
    case "paint-draw-poster": {
      // Capture failures stay fatal. Verification failures below return these
      // paths so the parent can report the retained files before failing the run.
      const artifacts = await retainPaintArtifacts(browserSession, workspacePath);
      if (artifacts) {
        result.artifacts = artifacts;
        result.notes.push(`Saved artwork: ${artifacts.imagePath}`, `Layered project: ${artifacts.projectPath}`);
      } else {
        result.notes.push("No draft was saved; no paint artifacts were retained.");
      }
      verify = async () => {
        await assertPaintOutcome(browserSession);
        const saved = await readPaintSaveRecord(browserSession);
        return saved
          ? `pixels=${saved.document.paintedPixelCount} · layers=${saved.document.layers.length}`
          : "saved=none";
      };
      break;
    }
    case "kanban-reprioritize-sprint":
      verify = async () => {
        await assertKanbanOutcome(browserSession, input.prompt);
        const observed = await readKanbanBoardState(browserSession);
        return Object.entries(observed)
          .map(([column, cards]) => `${column}: ${cards.join(" -> ")}`)
          .join(" | ");
      };
      break;
    case "booking-complete-reservation":
      verify = async () => {
        await assertBookingOutcome(browserSession, input.prompt);
        const confirmation = await readBookingConfirmation(browserSession);
        return confirmation
          ? `hotel=${confirmation.hotelName} · guest=${confirmation.guestName}`
          : "hotel=none · guest=none";
      };
      break;
    default:
      throw new Error(`Unsupported scenario: ${input.scenarioId}`);
  }
  if (input.verificationEnabled) {
    try {
      result.verificationDetail = await verify();
      result.verificationPassed = true;
    } catch (error) {
      result.verificationDetail = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

async function handle(operation: WorkerOperation) {
  if (operation.operation === "initialize") {
    if (session ||
      ![operation.endpoint, operation.url, operation.screenshotDir, operation.workspacePath, operation.targetLabel]
        .every(value => typeof value === "string") ||
      !["headless", "headful"].includes(operation.browserMode)) {
      throw new Error("Invalid worker initialization.");
    }
    workspacePath = operation.workspacePath;
    session = await connectBrowserSession(operation.endpoint, {
      browserMode: operation.browserMode,
      screenshotDir: operation.screenshotDir,
      workspacePath,
      startTarget: { kind: "remote_url", url: operation.url, label: operation.targetLabel },
    });
    session.context.setDefaultTimeout(10_000);
    session.context.setDefaultNavigationTimeout(15_000);
    repl = createRepl(session);
    return session.readState();
  }
  if (!session || !repl) throw new Error("JavaScript worker has not initialized.");
  switch (operation.operation) {
    case "execute":
      return execute(operation.code);
    case "inspect":
      return session.readState();
    case "capture":
      if (typeof operation.label !== "string") throw new Error("Invalid screenshot label.");
      return session.captureScreenshot(operation.label);
    case "finalize":
      if (typeof operation.scenarioId !== "string" ||
        typeof operation.prompt !== "string" ||
        typeof operation.verificationEnabled !== "boolean") {
        throw new Error("Invalid scenario finalization.");
      }
      return finalizeScenario(operation);
    default:
      throw new Error("Unknown JavaScript worker operation.");
  }
}

async function close() {
  if (closing) return;
  closing = true;
  try {
    await session?.close();
  } finally {
    process.exit(0);
  }
}

process.on("disconnect", () => {
  void close();
});
process.on("message", (message: unknown) => {
  if (closing) return;
  if (isRecord(message) && message.operation === "close") {
    void close();
    return;
  }
  if (!isRecord(message) || !Number.isSafeInteger(message.id) || busy) {
    process.send?.({ id: isRecord(message) ? message.id : null, error: "Invalid or concurrent JavaScript worker request." });
    return;
  }
  busy = true;
  void handle(message as WorkerOperation).then(
    result => {
      if (!closing) process.send?.({ id: message.id, result });
    },
    error => {
      if (!closing) process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  ).finally(() => {
    busy = false;
  });
});
