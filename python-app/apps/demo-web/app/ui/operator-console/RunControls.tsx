"use client";

import type {
  ResponseTurnBudget,
  ScenarioManifest,
} from "@cua-sample/replay-schema";

import {
  browserHelpText,
  turnBudgetHelpText,
  verificationHelpText,
} from "./helpers";
import type { ActionButtonsProps } from "./types";

type RunControlsProps = ActionButtonsProps & {
  controlsLocked: boolean;
  maxResponseTurns: ResponseTurnBudget;
  onMaxResponseTurnsChange: (value: ResponseTurnBudget) => void;
  onPromptChange: (value: string) => void;
  onScenarioChange: (value: string) => void;
  onVerificationEnabledChange: (value: boolean) => void;
  prompt: string;
  scenarios: ScenarioManifest[];
  selectedScenarioId: string;
  showActionButtons?: boolean;
  verificationEnabled: boolean;
};

type InfoPopoverProps = {
  id: string;
  label: string;
  text: string;
};

function InfoPopover({ id, label, text }: InfoPopoverProps) {
  return (
    <span className="fieldInfo">
      <button
        aria-describedby={id}
        aria-label={`${label} help`}
        className="fieldInfoButton"
        type="button"
      >
        i
      </button>
      <span className="fieldPopover" id={id} role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function RunActionButtons({
  onResetWorkspace,
  onStartRun,
  onStopRun,
  pendingAction,
  resetDisabled,
  startDisabled,
  startLabel = "Start Run",
  stopDisabled,
}: ActionButtonsProps) {
  return (
    <div className="stageToolbarActions">
      <button
        className="primaryButton"
        disabled={startDisabled}
        onClick={() => void onStartRun()}
        type="button"
      >
        {pendingAction === "start" ? "Starting..." : startLabel}
      </button>
      <button
        className="secondaryButton"
        disabled={stopDisabled}
        onClick={() => void onStopRun()}
        type="button"
      >
        {pendingAction === "stop" ? "Stopping..." : "Stop"}
      </button>
      <button
        className="secondaryButton"
        disabled={resetDisabled}
        onClick={() => void onResetWorkspace()}
        type="button"
      >
        {pendingAction === "reset" ? "Resetting..." : "Reset Workspace"}
      </button>
    </div>
  );
}

export function RunControls({
  controlsLocked,
  maxResponseTurns,
  onMaxResponseTurnsChange,
  onPromptChange,
  onScenarioChange,
  onVerificationEnabledChange,
  prompt,
  scenarios,
  selectedScenarioId,
  showActionButtons = true,
  verificationEnabled,
  ...actionButtons
}: RunControlsProps) {
  return (
    <aside className="panel controlsPanel" id="controls-pane" aria-label="Run controls">
      <div className="controlsHeader">
        <h2>Controls</h2>
      </div>

      <div className="controlsGrid">
        <div className="railField scenarioField">
          <label htmlFor="scenario-select">Scenario</label>
          <select
            disabled={controlsLocked}
            id="scenario-select"
            onChange={(event) => onScenarioChange(event.target.value)}
            value={selectedScenarioId}
          >
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.title}
              </option>
            ))}
          </select>
        </div>

        <div className="railField promptField">
          <label htmlFor="run-prompt">Run prompt</label>
          <textarea
            disabled={controlsLocked}
            id="run-prompt"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Describe the operator task for GPT-5.6."
            rows={4}
            value={prompt}
          />
        </div>
      </div>

      <details className="advancedPanel">
        <summary>
          <span className="advancedSummaryCopy">
            <span className="advancedLabel">Advanced settings</span>
            <span className="advancedHint">
              Browser, verification, and turn budget
            </span>
          </span>
        </summary>

        <div className="advancedContent">
          <div className="railField">
            <div className="fieldLabel">
              <span>Browser</span>
              <InfoPopover
                id="browser-help-popover"
                label="Browser"
                text={browserHelpText}
              />
            </div>
            <span className="advancedHint">Visible desktop</span>
          </div>

          <div className="railField budgetField">
            <div className="fieldLabel">
              <label htmlFor="turn-budget">Turn budget</label>
              <InfoPopover
                id="turn-budget-help-popover"
                label="Turn budget"
                text={turnBudgetHelpText}
              />
            </div>
            <div className="budgetControl">
              <input
                disabled={controlsLocked}
                id="turn-budget"
                max={50}
                min={4}
                onChange={(event) =>
                  onMaxResponseTurnsChange(
                    Number(event.target.value) as ResponseTurnBudget,
                  )
                }
                step={1}
                type="range"
                value={maxResponseTurns}
              />
              <span className="budgetValue">{maxResponseTurns} turns</span>
            </div>
          </div>

          <div className="railField">
            <div className="fieldLabel">
              <span>Verification</span>
              <InfoPopover
                id="verification-help-popover"
                label="Verification"
                text={verificationHelpText}
              />
            </div>
            <label className="feedToggle">
              <input
                checked={verificationEnabled}
                disabled={controlsLocked}
                onChange={(event) => onVerificationEnabledChange(event.target.checked)}
                type="checkbox"
              />
              Run verification checks
            </label>
          </div>
        </div>
      </details>

      {showActionButtons ? <RunActionButtons {...actionButtons} /> : null}
    </aside>
  );
}
