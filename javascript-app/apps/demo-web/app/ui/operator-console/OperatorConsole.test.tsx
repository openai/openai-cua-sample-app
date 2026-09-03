import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    model: "gpt-5.6-sol",
    prompt: scenario.defaultPrompt,
    scenarioId: scenario.id,
    startedAt: "2026-04-18T12:00:00.000Z",
    status: "running",
  },
  scenario,
  workspacePath: "/tmp/test-run/workspace",
};

function capturedFrame(index: number): BrowserScreenshotArtifact {
  return {
    capturedAt: `2026-04-18T12:00:0${index}.000Z`,
    id: `browser-frame-${index}`,
    label: `browser-step-${index}`,
    mimeType: "image/png",
    pageTitle: scenario.title,
    pageUrl: "http://127.0.0.1:3102",
    path: `/tmp/test-run/screenshots/browser-frame-${index}.png`,
    url: `/api/runs/test-run/artifacts/screenshots/browser-frame-${index}.png`,
  };
}

function capturedFrameEvent(
  screenshot: BrowserScreenshotArtifact,
  sequence: number,
): RunEvent {
  return {
    createdAt: screenshot.capturedAt,
    detail: screenshot.url,
    id: `screenshot-captured-${sequence}`,
    level: "ok",
    message: "Browser screenshot captured.",
    runId: runDetail.run.id,
    sequence,
    type: "screenshot_captured",
  };
}

function runWithFrames(screenshots: BrowserScreenshotArtifact[]): RunDetail {
  return {
    ...runDetail,
    browser: {
      currentUrl: "http://127.0.0.1:3102",
      mode: "headless",
      pageTitle: scenario.title,
      screenshots,
      targetLabel: scenario.title,
      viewport: { height: 800, width: 1280 },
    },
    events: screenshots.map((screenshot, index) =>
      capturedFrameEvent(screenshot, index + 1),
    ),
  };
}

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

  it("keeps drafts and advanced settings mounted while switching workspace panels", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );
    const navigation = screen.getByRole("navigation", { name: "Workspace panels" });
    const controlsButton = within(navigation).getByRole("button", { name: "Controls" });
    const previewButton = within(navigation).getByRole("button", { name: "Preview" });
    const activityButton = within(navigation).getByRole("button", { name: "Activity" });
    const controls = screen.getByRole("complementary", { name: "Run controls" });
    const preview = screen.getByRole("region", { name: "Screenshot preview" });
    const activity = screen.getByRole("region", { name: "Agent activity" });
    const workspace = container.querySelector(".benchTop");
    const prompt = screen.getByRole("textbox", { name: "Run prompt" }) as HTMLTextAreaElement;

    expect(workspace?.getAttribute("data-panel")).toBe("controls");
    expect(controlsButton.getAttribute("aria-pressed")).toBe("true");
    expect(controlsButton.getAttribute("aria-controls")).toBe(controls.id);
    expect(previewButton.getAttribute("aria-controls")).toBe(preview.id);
    expect(activityButton.getAttribute("aria-controls")).toBe(activity.id);
    expect(screen.getByRole("button", { name: "Start Run" }).closest(".benchTop")).toBeNull();

    await user.clear(prompt);
    await user.type(prompt, "Keep this unfinished prompt.");
    await user.click(screen.getByText("Advanced settings"));
    const advancedSettings = screen.getByText("Advanced settings").closest("details");
    await user.click(screen.getByRole("button", { name: "Visible" }));
    await user.click(screen.getByRole("checkbox", { name: "Run verification checks" }));
    fireEvent.change(screen.getByRole("slider", { name: "Turn budget" }), {
      target: { value: "32" },
    });

    await user.click(previewButton);
    expect(workspace?.getAttribute("data-panel")).toBe("preview");
    expect(previewButton.getAttribute("aria-pressed")).toBe("true");
    expect(controlsButton.getAttribute("aria-pressed")).toBe("false");
    await user.click(activityButton);
    expect(workspace?.getAttribute("data-panel")).toBe("activity");
    expect(activityButton.getAttribute("aria-pressed")).toBe("true");
    await user.click(controlsButton);

    expect(screen.getByRole("complementary", { name: "Run controls" })).toBe(controls);
    expect(screen.getByRole("region", { name: "Screenshot preview" })).toBe(preview);
    expect(screen.getByRole("region", { name: "Agent activity" })).toBe(activity);
    expect(screen.getByRole("textbox", { name: "Run prompt" })).toBe(prompt);
    expect(prompt.value).toBe("Keep this unfinished prompt.");
    expect(advancedSettings?.open).toBe(true);
    expect(screen.getByRole("button", { name: "Visible" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("checkbox", { name: "Run verification checks" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement).value).toBe("32");
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
        /Start `pnpm dev` from `javascript-app`/,
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

    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");

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
    const turnBudget = screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement;
    expect(turnBudget.value).toBe("24");
    expect(turnBudget.max).toBe("50");

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
      maxResponseTurns: 24,
      prompt: scenario.defaultPrompt,
      scenarioId: scenario.id,
      verificationEnabled: true,
    });
    expect(payload).not.toHaveProperty("mode");
    expect(payload).not.toHaveProperty("model");
  });

  it("restores the active scenario, options, screenshot and Stop after a page refresh", async () => {
    const activeScenario: ScenarioManifest = { ...scenario, id: "paint-draw-poster", labId: "paint", title: "Sketch Studio" };
    const active = runWithFrames([capturedFrame(1)]);
    active.scenario = activeScenario;
    active.run = {
      ...active.run, scenarioId: activeScenario.id, labId: activeScenario.labId,
      prompt: "Finish this drawing", browserMode: "headful", verificationEnabled: true, maxResponseTurns: 32,
    };
    render(<OperatorConsole initialRun={active} initialRunnerIssue={null}
      runnerBaseUrl="http://127.0.0.1:4001" scenarios={[scenario, activeScenario]} />);

    expect((screen.getByRole("combobox", { name: "Scenario" }) as HTMLSelectElement).value).toBe(activeScenario.id);
    expect((screen.getByRole("textbox", { name: "Run prompt" }) as HTMLTextAreaElement).value).toBe("Finish this drawing");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Captured frame 1 for Sketch Studio" }).getAttribute("src")).toContain(active.browser!.screenshots[0]!.url);
    expect((screen.getByRole("button", { name: "Start Run" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(false);

    await userEvent.setup().click(screen.getByText("Advanced settings"));
    expect(screen.getByRole("button", { name: "Visible" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("checkbox", { name: "Run verification checks" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement).value).toBe("32");
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("enables Stop from the accepted start response without a follow-up snapshot", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      eventStreamUrl: runDetail.eventStreamUrl,
      replayUrl: runDetail.replayUrl,
      runId: runDetail.run.id,
      status: "running",
      detail: runDetail,
    })).mockRejectedValue(new Error("Snapshot unavailable"));
    render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));
    expect(screen.getByText("Run active")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
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

  it("opens activity frames in Preview and keeps a pinned frame when new captures arrive", async () => {
    const user = userEvent.setup();
    const first = capturedFrame(1);
    const second = capturedFrame(2);
    const third = capturedFrame(3);
    mockRunStart(runWithFrames([first, second]));

    render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Captured frame 2 for Launch Planner" })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Activity" }));
    await user.click(screen.getByRole("button", { name: "Frame 1" }));
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Captured frame 1 for Launch Planner" }).getAttribute("src")).toBe(`http://127.0.0.1:4001${first.url}`);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(runWithFrames([first, second, third])));
    await act(async () => MockEventSource.instances.at(-1)!.emit(capturedFrameEvent(third, 3)));
    await waitFor(() => {
      expect(screen.getByText("Frame 1 / 3")).toBeTruthy();
    });
    expect((screen.getByRole("slider", { name: "Captured frame scrubber" }) as HTMLInputElement).value).toBe("0");
    expect(screen.getByText("Pinned frame")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(screen.getByRole("img", { name: "Captured frame 3 for Launch Planner" })).toBeTruthy();
    expect(screen.getByText("Live frame")).toBeTruthy();
  });

  it("collapses thumbnails by default and preserves selection when toggling them", async () => {
    const user = userEvent.setup();
    mockRunStart(runWithFrames([capturedFrame(1), capturedFrame(2)]));

    render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Captured frame 2 for Launch Planner" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "View frame 1" })).toBeNull();
    expect(screen.getByRole("slider", { name: "Captured frame scrubber" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show thumbnails" }));
    expect(screen.getByRole("button", { name: "View frame 2" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "View frame 1" }));
    expect(screen.getByRole("button", { name: "View frame 1" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Controls" }));
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("button", { name: "Hide thumbnails" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hide thumbnails" }));
    expect(screen.queryByRole("button", { name: "View frame 1" })).toBeNull();
    expect(screen.getByRole("img", { name: "Captured frame 1 for Launch Planner" })).toBeTruthy();
    expect((screen.getByRole("slider", { name: "Captured frame scrubber" }) as HTMLInputElement).value).toBe("0");
  });
});
