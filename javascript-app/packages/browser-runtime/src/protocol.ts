import type { BrowserMode } from "@cua-sample/replay-schema";

export type JavaScriptOutput =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "original" };

export type ScenarioFinalization = {
  notes: string[];
  verificationPassed: boolean;
  // Failed verification preserves artifact paths and explains the failure here.
  verificationDetail?: string;
  artifacts?: { imagePath: string; projectPath: string };
};

export type WorkerOperation =
  | {
    operation: "initialize";
    endpoint: string;
    url: string;
    targetLabel: string;
    browserMode: BrowserMode;
    screenshotDir: string;
    workspacePath: string;
  }
  | { operation: "execute"; code: string }
  | { operation: "inspect" }
  | { operation: "capture"; label: string }
  | {
    operation: "finalize";
    scenarioId: string;
    prompt: string;
    verificationEnabled: boolean;
  }
  | { operation: "close" };

export const maxCodeBytes = 64 * 1024;
export const maxOutputBytes = 12 * 1024 * 1024;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJavaScriptOutput(value: unknown): JavaScriptOutput[] {
  if (!Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > maxOutputBytes) {
    throw new Error("JavaScript output is invalid or exceeds 12 MiB.");
  }
  return value.map((item: unknown) => {
    if (isRecord(item) && item.type === "input_text" && typeof item.text === "string") {
      return { type: "input_text", text: item.text };
    }
    if (isRecord(item) && item.type === "input_image" && typeof item.image_url === "string" &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.image_url)) {
      return { type: "input_image", image_url: item.image_url, detail: "original" };
    }
    throw new Error("JavaScript returned an unsupported output item.");
  });
}

export function parseFinalization(value: unknown): ScenarioFinalization {
  if (!isRecord(value) || !Array.isArray(value.notes) || !value.notes.every(note => typeof note === "string") ||
    typeof value.verificationPassed !== "boolean" ||
    (value.verificationDetail !== undefined && typeof value.verificationDetail !== "string") ||
    (value.artifacts !== undefined && (!isRecord(value.artifacts) || typeof value.artifacts.imagePath !== "string" || typeof value.artifacts.projectPath !== "string"))) {
    throw new Error("JavaScript worker returned invalid scenario results.");
  }
  return value as ScenarioFinalization;
}
