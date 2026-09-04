"use client";

type RunSummaryProps = {
  runnerOnline: boolean;
  topbarSubtitle: string;
};

type StageSummaryProps = {
  stageHeadline: string;
  stageSupportCopy: string | null;
};

export function ConsoleTopbar({
  runnerOnline,
  topbarSubtitle,
}: RunSummaryProps) {
  return (
    <header className="consoleTopbar">
      <div className="brandBlock">
        <div className="brandMark">
          <span>GPT</span>
          <strong>5.6</strong>
        </div>
        <div className="brandCopy">
          <h1>GPT-5.6 CUA Sample App</h1>
          <p>
            <span className="stackLabel">Python / PyAutoGUI</span>
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
