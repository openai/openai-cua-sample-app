import type {
  ResponseTurnBudget,
  RunEventLevel,
  ScenarioManifest,
} from "@cua-sample/replay-schema";

export type OperatorConsoleProps = {
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
  lane: "control" | "operator" | "verification";
  speaker: string;
  time: string;
};

export type ActivityItem = {
  code?: string;
  createdAt: string;
  detail?: string;
  family: "observe" | "operator" | "snapshot" | "system" | "tool" | "verify";
  headline: string;
  key: string;
  level: RunEventLevel;
  screenshotId?: string;
  summary: string;
  time: string;
};

export type PendingAction = "reset" | "start" | "stop" | null;

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
  stopDisabled: boolean;
};

export type RunDefaults = {
  defaultMaxResponseTurns: ResponseTurnBudget;
  defaultRunModel: string;
};
