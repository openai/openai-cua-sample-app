import { scenarioFixture } from "./test-fixtures";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunDetail, ScenarioManifest } from "@cua-sample/replay-schema";

import { createRunnerUnavailableIssue } from "./helpers";
import { OperatorConsole } from "./OperatorConsole";

const scenario = scenarioFixture;

class MockEventSource {
  close() {}

  onerror: ((event: Event) => void) | null = null;

  onmessage: ((event: MessageEvent<string>) => void) | null = null;

}

describe("OperatorConsole", () => {
  beforeEach(() => {
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
        runnerBaseUrl="http://127.0.0.1:4041"
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
        /Start `pnpm dev` from `python-app`/,
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
        runnerBaseUrl="http://127.0.0.1:4041"
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

  it("starts Python execution without an execution mode or Headless controls", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ code: "missing_api_key", error: "No API key configured." }),
      ok: false,
      status: 400,
    } as Response);
    render(<OperatorConsole initialRunnerIssue={null} runnerBaseUrl="http://127.0.0.1:4041" scenarios={[scenario]} />);
    await user.click(screen.getByText("Advanced settings"));
    expect(screen.queryByRole("button", { name: "Headless" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Browser mode" })).toBeNull();
    expect(screen.getByText("Visible desktop")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Native" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Execution mode" })).toBeNull();
    const start = screen.getByRole("button", { name: "Start Run" }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    await user.click(start);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, request] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4041/api/runs");
    expect(JSON.parse(request?.body as string)).toMatchObject({
      browserMode: "headful",
    });
    expect(JSON.parse(request?.body as string)).not.toHaveProperty("mode");
    expect(JSON.parse(request?.body as string)).not.toHaveProperty("model");
  });

  it("preserves the draft and keeps run actions available when switching panels", async () => {
    const user = userEvent.setup();
    render(<OperatorConsole initialRunnerIssue={null} runnerBaseUrl="http://127.0.0.1:4041" scenarios={[scenario]} />);
    const prompt = screen.getByRole("textbox", { name: "Run prompt" });
    await user.clear(prompt);
    await user.type(prompt, "Move the last card to Done.");

    for (const panel of ["Preview", "Activity", "Controls"]) {
      const button = screen.getByRole("button", { name: panel });
      await user.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByRole("button", { name: "Start Run" }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByRole("button", { name: "Reset Workspace" })).toBeTruthy();
    }
    expect((prompt as HTMLTextAreaElement).value).toBe("Move the last card to Done.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("restores the active run and Stop after a page refresh", async () => {
    const activeScenario: ScenarioManifest = { ...scenario, id: "alternate-scenario", labId: "paint", title: "Alternate App" };
    const active: RunDetail = {
      run: {
        id: "active", scenarioId: activeScenario.id, labId: activeScenario.labId,
        browserMode: "headful", model: "runner-model", prompt: "Finish this drawing",
        status: "running", startedAt: "2026-09-03T00:00:00.000Z",
        verificationEnabled: true, maxResponseTurns: 32,
      },
      scenario: activeScenario, workspacePath: "/tmp/active",
      eventStreamUrl: "/api/runs/active/events", replayUrl: "/api/runs/active/replay", events: [],
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({
      ...active, run: { ...active.run, status: "cancelled" },
    }) } as Response);
    render(<OperatorConsole initialRun={active} initialRunnerIssue={null}
      runnerBaseUrl="http://127.0.0.1:4041" scenarios={[scenario, activeScenario]} />);
    expect((screen.getByRole("combobox", { name: "Scenario" }) as HTMLSelectElement).value).toBe(activeScenario.id);
    expect((screen.getByRole("textbox", { name: "Run prompt" }) as HTMLTextAreaElement).value).toBe("Finish this drawing");
    expect((screen.getByRole("button", { name: "Start Run" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(false);
    const user = userEvent.setup();
    await user.click(screen.getByText("Advanced settings"));
    expect((screen.getByRole("checkbox", { name: "Run verification checks" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("slider", { name: "Turn budget" }) as HTMLInputElement).value).toBe("32");
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4041/api/runs/active/stop", expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect((screen.getByRole("button", { name: "Start Run" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("opens Preview for a run or activity frame and preserves selection when thumbnails collapse", async () => {
    const user = userEvent.setup();
    const capturedAt = "2026-09-03T00:00:00.000Z";
    const screenshots = [1, 2].map((index) => ({
      id: `frame-${index}`, label: `frame-${index}`, capturedAt,
      mimeType: "image/png" as const, pageUrl: "http://127.0.0.1/lab",
      path: `/tmp/frame-${index}.png`, url: `/api/frames/${index}.png`,
    }));
    const detail: RunDetail = {
      run: {
        id: "preview-run", scenarioId: scenario.id, labId: scenario.labId,
        browserMode: "headful", model: "gpt-5.6",
        prompt: scenario.defaultPrompt, status: "running", startedAt: capturedAt,
      },
      scenario, workspacePath: "/tmp/preview-run",
      eventStreamUrl: "/api/runs/preview-run/events", replayUrl: "/api/runs/preview-run/replay",
      browser: {
        currentUrl: "http://127.0.0.1/lab", mode: "headful", screenshots,
        targetLabel: "Lab", viewport: { width: 1440, height: 900 },
      },
      events: [{
        id: "event-1", runId: "preview-run", sequence: 1, type: "screenshot_captured",
        level: "ok", message: "Screenshot captured", detail: screenshots[0]!.url, createdAt: capturedAt,
      }],
    };
    vi.mocked(fetch).mockImplementation(async (url) => ({
      ok: true,
      json: async () => String(url).endsWith("/api/runs")
        ? { runId: detail.run.id, status: "running", eventStreamUrl: detail.eventStreamUrl, replayUrl: detail.replayUrl, detail }
        : detail,
    }) as Response);
    render(<OperatorConsole initialRunnerIssue={null} runnerBaseUrl="http://127.0.0.1:4041" scenarios={[scenario]} />);

    await user.click(screen.getByRole("button", { name: "Start Run" }));
    await screen.findByRole("img", { name: "Captured frame 2 for Demo App" });
    const previewButton = screen.getByRole("button", { name: "Preview" });
    expect(previewButton.getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Activity" }));
    await user.click(within(screen.getByRole("region", { name: "Agent activity" })).getByRole("button", { name: "Frame 1" }));
    expect(previewButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Captured frame 1 for Demo App" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View frame 1" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show thumbnails" }));
    await user.click(screen.getByRole("button", { name: "View frame 2" }));
    await user.click(screen.getByRole("button", { name: "Hide thumbnails" }));
    expect(screen.getByRole("img", { name: "Captured frame 2 for Demo App" })).toBeTruthy();
    expect((screen.getByRole("slider", { name: "Captured frame scrubber" }) as HTMLInputElement).value).toBe("1");
  });
});
