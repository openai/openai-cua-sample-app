import type {
  BackendCapabilities,
  RunDetail,
  RunEventLevel,
  ScenarioManifest,
} from "@cua-sample/contracts";

export type OperatorConsoleProps = {
  capabilities: BackendCapabilities | null;
  expectedBackend: BackendCapabilities["backendId"];
  initialRun?: RunDetail | null;
  initialRunnerIssue: RunnerIssue | null;
  runnerBaseUrl: string;
  scenarios: ScenarioManifest[];
};

export type LogEntry = {
  createdAt: string;
  detail: string;
  event: string;
  level: RunEventLevel;
  key: string;
  time: string;
};

export type TranscriptEntry = {
  body: string;
  createdAt: string;
  key: string;
  speaker: string;
  time: string;
};

export type ActivityItem = {
  code?: string;
  createdAt: string;
  detail?: string;
  family: "observe" | "operator" | "snapshot" | "system" | "tool";
  headline: string;
  key: string;
  level: RunEventLevel;
  screenshotId?: string;
  summary: string;
  time: string;
};

export type PendingAction = "reset" | "start" | "stop" | "check" | null;

export type RunnerIssue = {
  code: string;
  error: string;
  hint?: string;
  title: string;
};

export type ActionButtonsProps = {
  onResetWorkspace: () => Promise<void>;
  onStartRun: () => Promise<void>;
  onStopRun: () => Promise<void>;
  pendingAction: PendingAction;
  resetDisabled: boolean;
  startDisabled: boolean;
  startLabel?: string;
  stopDisabled: boolean;
};
