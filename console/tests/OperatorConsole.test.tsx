import { javascriptBackendProps } from "./fixtures";
import { scenarioFixture } from "./fixtures";
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
} from "@cua-sample/contracts";

import { createRunnerUnavailableIssue } from "../components/helpers";
import { OperatorConsole } from "../components/OperatorConsole";

const scenario = scenarioFixture;

const runDetail: RunDetail = {
  eventStreamUrl: "/api/runs/test-run/events",
  events: [],
  replayUrl: "/api/runs/test-run/replay",
  run: {
    browserMode: "headless",
    maxResponseTurns: 24,
    id: "test-run",
    labId: scenario.labId,
    model: "test-model",
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
        detail,
        eventStreamUrl: detail.eventStreamUrl,
        replayUrl: detail.replayUrl,
        runId: detail.run.id,
        status: "running",
      }),
    );
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
      <OperatorConsole {...javascriptBackendProps}
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
    expect((screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement).value).toBe("32");
  });

  it("explains how to recover when the runner is offline", () => {
    render(
      <OperatorConsole {...javascriptBackendProps}
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
        /Start the selected backend from the repository root/,
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
      <OperatorConsole {...javascriptBackendProps}
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

  it("starts with the selected browser and turn budget without verification controls or request fields", async () => {
    const user = userEvent.setup();
    mockRunStart();

    render(
      <OperatorConsole {...javascriptBackendProps}
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByText("Advanced settings"));

    expect(screen.getByText("Browser and turn budget")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /verification/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /verification/i })).toBeNull();

    expect(
      screen.getByRole("button", { name: "Headless" }).getAttribute("aria-pressed"),
    ).toBe("true");
    const turnBudget = screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement;
    expect(turnBudget.value).toBe("24");
    expect(turnBudget.max).toBe("50");

    await user.click(screen.getByRole("button", { name: "Visible" }));
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
    });
    expect(payload).not.toHaveProperty("verificationEnabled");
    expect(payload.model).toBe(javascriptBackendProps.capabilities.defaults.model);
    expect(options?.headers).toMatchObject({ "X-CUA-Backend": "javascript" });
  });

  it("restores the active scenario, options, screenshot and Stop after a page refresh", async () => {
    const activeScenario: ScenarioManifest = { ...scenario, id: "alternate-scenario", labId: "paint", title: "Alternate App" };
    const active = runWithFrames([capturedFrame(1)]);
    active.scenario = activeScenario;
    active.run = {
      ...active.run, scenarioId: activeScenario.id, labId: activeScenario.labId,
      prompt: "Finish this drawing", browserMode: "headful", maxResponseTurns: 32,
    };
    render(<OperatorConsole {...javascriptBackendProps} initialRun={active} initialRunnerIssue={null}
      runnerBaseUrl="http://127.0.0.1:4001" scenarios={[scenario, activeScenario]} />);

    expect((screen.getByRole("combobox", { name: "Scenario" }) as HTMLSelectElement).value).toBe(activeScenario.id);
    expect((screen.getByRole("textbox", { name: "Run prompt" }) as HTMLTextAreaElement).value).toBe("Finish this drawing");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Captured frame 1 for Alternate App" }).getAttribute("src")).toContain(active.browser!.screenshots[0]!.url);
    expect((screen.getByRole("button", { name: "Start Run" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(false);

    await userEvent.setup().click(screen.getByText("Advanced settings"));
    expect(screen.getByRole("button", { name: "Visible" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement).value).toBe("32");
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("shows a finished run and model response as system activity while retaining replay access", async () => {
    const user = userEvent.setup();
    const openReplay = vi.fn();
    vi.stubGlobal("open", openReplay);
    const finished = runWithFrames([capturedFrame(1)]);
    finished.run = {
      ...finished.run,
      status: "completed",
      summary: { notes: ["The model finished its response."], stepCount: 3, screenshotCount: 1 },
    };
    finished.events.push({
      id: "model-final", runId: finished.run.id, sequence: 2,
      createdAt: "2026-04-18T12:00:02.000Z", type: "run_progress", level: "ok",
      message: "Model returned a final response.", detail: "I finished the requested drawing.",
    }, {
      id: "run-finished", runId: finished.run.id, sequence: 3,
      createdAt: "2026-04-18T12:00:03.000Z", type: "run_completed", level: "ok",
      message: "Run finished and replay bundle persisted.",
    });
    const { container } = render(<OperatorConsole {...javascriptBackendProps} initialRun={finished}
      initialRunnerIssue={null} runnerBaseUrl="http://127.0.0.1:4001" scenarios={[scenario]} />);

    expect(container.querySelector(".stageStatusStrip")?.textContent).toBe("Run finished");
    expect(screen.getByText("Model returned a final response").closest(".activityRow")?.className).toContain("family-system");
    expect(screen.queryByText("Verify")).toBeNull();
    expect(screen.queryByText("Run completed")).toBeNull();
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("img", { name: "Captured frame 1 for Demo App" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Captured frame scrubber" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Replay JSON" }));
    expect(openReplay).toHaveBeenCalledWith(`http://127.0.0.1:4001${finished.replayUrl}`, "_blank");
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
      pageTitle: "Demo App",
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
      <OperatorConsole {...javascriptBackendProps}
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
          name: "Captured frame 1 for Demo App",
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
      <OperatorConsole {...javascriptBackendProps}
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Captured frame 2 for Demo App" })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Activity" }));
    await user.click(screen.getByRole("button", { name: "Frame 1" }));
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Captured frame 1 for Demo App" }).getAttribute("src")).toBe(`http://127.0.0.1:4001${first.url}`);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(runWithFrames([first, second, third])));
    await act(async () => MockEventSource.instances.at(-1)!.emit(capturedFrameEvent(third, 3)));
    await waitFor(() => {
      expect(screen.getByText("Frame 1 / 3")).toBeTruthy();
    });
    expect((screen.getByRole("slider", { name: "Captured frame scrubber" }) as HTMLInputElement).value).toBe("0");
    expect(screen.getByText("Pinned frame")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(screen.getByRole("img", { name: "Captured frame 3 for Demo App" })).toBeTruthy();
    expect(screen.getByText("Live frame")).toBeTruthy();
  });

  it("collapses thumbnails by default and preserves selection when toggling them", async () => {
    const user = userEvent.setup();
    mockRunStart(runWithFrames([capturedFrame(1), capturedFrame(2)]));

    render(
      <OperatorConsole {...javascriptBackendProps}
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Captured frame 2 for Demo App" })).toBeTruthy();
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
    expect(screen.getByRole("img", { name: "Captured frame 1 for Demo App" })).toBeTruthy();
    expect((screen.getByRole("slider", { name: "Captured frame scrubber" }) as HTMLInputElement).value).toBe("0");
  });
});
