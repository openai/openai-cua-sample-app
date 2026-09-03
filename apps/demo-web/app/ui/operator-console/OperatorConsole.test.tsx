import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserScreenshotArtifact,
  RunDetail,
  RunEvent,
  ScenarioManifest,
} from "@cua-sample/replay-schema";

import { createRunnerUnavailableIssue } from "./helpers";
import { OperatorConsole } from "./OperatorConsole";

const scenario: ScenarioManifest = {
  category: "productivity",
  defaultPrompt: [
    "Reorganize the board to match this requested final board state exactly.",
    "",
    "backlog: Refresh workspace docs",
    "in_progress: Close nav bug triage -> Finalize analytics spec",
    "done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips",
  ].join("\n"),
  description:
    "Move cards across columns and reorder the sprint board to match the final board state.",
  id: "kanban-reprioritize-sprint",
  labId: "kanban",
  startTarget: {
    kind: "remote_url",
    label: "run-scoped HTTP kanban lab",
    url: "http://127.0.0.1:3102",
  },
  supportsCodeEdits: false,
  tags: ["hero", "productivity", "drag-drop"],
  title: "Launch Planner",
  verification: [
    {
      description: "The final board state matches the required card ordering.",
      id: "kanban-board-state",
      kind: "board_state",
    },
  ],
  workspaceTemplatePath: "/tmp/kanban-lab-template",
};

const runDetail: RunDetail = {
  eventStreamUrl: "/api/runs/test-run/events",
  events: [],
  replayUrl: "/api/runs/test-run/replay",
  run: {
    browserMode: "headless",
    id: "test-run",
    labId: scenario.labId,
    model: "gpt-5.4",
    prompt: scenario.defaultPrompt,
    scenarioId: scenario.id,
    startedAt: "2026-04-18T12:00:00.000Z",
    status: "running",
  },
  scenario,
  workspacePath: "/tmp/test-run/workspace",
};

function jsonResponse(payload: unknown) {
  return {
    json: async () => payload,
    ok: true,
    status: 200,
  } as Response;
}

function mockRunStart(detail: RunDetail = runDetail) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      jsonResponse({
        eventStreamUrl: detail.eventStreamUrl,
        replayUrl: detail.replayUrl,
        runId: detail.run.id,
        status: "running",
      }),
    )
    .mockResolvedValueOnce(jsonResponse(detail));
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  close() {}

  onerror: ((event: Event) => void) | null = null;

  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  emit(event: RunEvent) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
}

describe("OperatorConsole", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("explains how to recover when the runner is offline", () => {
    render(
      <OperatorConsole
        initialRunnerIssue={createRunnerUnavailableIssue("Connection refused")}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[]}
      />,
    );

    expect(screen.getByText("Runner unavailable")).toBeTruthy();
    expect(
      screen.getAllByText(
        /The operator console could not reach the runner\. Connection refused/,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /Start `pnpm dev` or `OPENAI_API_KEY=... pnpm dev:runner`/,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Runner Offline")).toBeTruthy();
  });

  it("surfaces structured runner guidance when a run cannot start", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue({
      json: async () => ({
        code: "missing_api_key",
        error: "OPENAI_API_KEY is not configured in the runner.",
        hint: "Set OPENAI_API_KEY and restart the runner.",
      }),
      ok: false,
      status: 400,
    } as Response);

    render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));

    await waitFor(() => {
      expect(screen.getByText("Runner missing API key")).toBeTruthy();
    });
    expect(
      screen.getAllByText(
        /OPENAI_API_KEY is not configured in the runner\. Set OPENAI_API_KEY and restart the runner\./,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("starts without an execution mode while preserving browser and verification controls", async () => {
    const user = userEvent.setup();
    mockRunStart();

    render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByText("Advanced settings"));

    expect(screen.queryByRole("tablist", { name: "Execution mode" })).toBeNull();
    expect(screen.queryByText("Engine")).toBeNull();
    expect(screen.queryByRole("button", { name: "Native" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Headless" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("slider", { name: "Turn budget" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Visible" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Run verification checks" }),
    );
    await user.click(screen.getByRole("button", { name: "Start Run" }));

    await waitFor(() => {
      expect(screen.getByText("Run active")).toBeTruthy();
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    const payload = JSON.parse(String(options?.body)) as Record<string, unknown>;

    expect(url).toBe("http://127.0.0.1:4001/api/runs");
    expect(options?.method).toBe("POST");
    expect(payload).toMatchObject({
      browserMode: "headful",
      prompt: scenario.defaultPrompt,
      scenarioId: scenario.id,
      verificationEnabled: true,
    });
    expect(payload).not.toHaveProperty("mode");
  });

  it("streams browser script activity and displays captured frames", async () => {
    const user = userEvent.setup();
    const code = 'await page.getByRole("button", { name: "Save" }).click();';
    const scriptEvent: RunEvent = {
      createdAt: "2026-04-18T12:00:01.000Z",
      detail: `exec_js ${JSON.stringify({ code })}`,
      id: "script-requested",
      level: "pending",
      message: "Function tool call received from the model.",
      runId: runDetail.run.id,
      sequence: 1,
      type: "function_call_requested",
    };
    const screenshot: BrowserScreenshotArtifact = {
      capturedAt: "2026-04-18T12:00:02.000Z",
      id: "browser-frame",
      label: "browser-step",
      mimeType: "image/png",
      pageTitle: "Launch Planner",
      pageUrl: "http://127.0.0.1:3102",
      path: "/tmp/test-run/screenshots/browser-frame.png",
      url: "/api/runs/test-run/artifacts/screenshots/browser-frame.png",
    };
    const screenshotEvent: RunEvent = {
      createdAt: screenshot.capturedAt,
      detail: screenshot.url,
      id: "screenshot-captured",
      level: "ok",
      message: "Browser screenshot captured.",
      runId: runDetail.run.id,
      sequence: 2,
      type: "screenshot_captured",
    };
    mockRunStart();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ...runDetail,
        browser: {
          currentUrl: screenshot.pageUrl,
          mode: "headless",
          pageTitle: screenshot.pageTitle,
          screenshots: [screenshot],
          targetLabel: scenario.title,
          viewport: { height: 800, width: 1280 },
        },
        events: [scriptEvent, screenshotEvent],
      } satisfies RunDetail),
    );

    render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));
    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });
    const source = MockEventSource.instances[0]!;
    expect(source.url).toBe("http://127.0.0.1:4001/api/runs/test-run/events");

    await act(async () => source.emit(scriptEvent));
    await user.click(screen.getByText("Run browser script"));
    expect(screen.getByText(code)).toBeTruthy();

    await act(async () => source.emit(screenshotEvent));
    await waitFor(() => {
      expect(
        screen.getByRole("img", {
          name: "Captured frame 1 for Launch Planner",
        }).getAttribute("src"),
      ).toBe(`http://127.0.0.1:4001${screenshot.url}`);
    });

    expect(screen.getAllByText("Captured Browser Step")).toHaveLength(1);
    expect(screen.getByText("Frame 1 / 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Frame 1" })).toBeTruthy();
    expect(screen.getByText("Run browser script")).toBeTruthy();
  });
});
