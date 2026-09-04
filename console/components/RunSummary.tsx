"use client";

import { DEFAULT_MODEL_DISPLAY_NAME } from "@cua-sample/contracts";

type RunSummaryProps = {
  backendId: "javascript" | "python";
  runnerOnline: boolean;
  topbarSubtitle: string;
};

type StageSummaryProps = {
  stageHeadline: string;
  stageSupportCopy: string | null;
};

export function ConsoleTopbar({
  backendId,
  runnerOnline,
  topbarSubtitle,
}: RunSummaryProps) {
  return (
    <header className="consoleTopbar">
      <div className="brandBlock">
        <div className="brandMark">
          <span>{DEFAULT_MODEL_DISPLAY_NAME}</span>
        </div>
        <div className="brandCopy">
          <h1>{DEFAULT_MODEL_DISPLAY_NAME} CUA Sample App</h1>
          <p>
            <span className="stackLabel">{backendId === "python" ? "Python / PyAutoGUI" : "JavaScript / Playwright"}</span>
            <span className="brandContext"> · {topbarSubtitle}</span>
          </p>
        </div>
      </div>
      <div className="statusCluster">
        <div className={`statusPill ${runnerOnline ? "ok" : "error"}`}>
          <span className="statusDot" />
          {runnerOnline ? "Runner Online" : "Runner Offline"}
        </div>
      </div>
    </header>
  );
}

export function RunSummary({
  stageHeadline,
  stageSupportCopy,
}: StageSummaryProps) {
  return (
    <div className="stageReviewMeta">
      <div className="stageStatusStrip">
        <span className="stageStatusItem">{stageHeadline}</span>
      </div>
      {stageSupportCopy ? <p className="stageNow">{stageSupportCopy}</p> : null}
    </div>
  );
}
