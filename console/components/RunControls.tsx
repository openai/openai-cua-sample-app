"use client";

import type {
  BackendCapabilities,
  BrowserMode,
  ResponseTurnBudget,
  ScenarioManifest,
} from "@cua-sample/contracts";

import {
  browserHelpText,
  turnBudgetHelpText,
} from "./helpers";
import type { ActionButtonsProps } from "./types";

type RunControlsProps = {
  backendId: BackendCapabilities["backendId"];
  browserModes: BrowserMode[];
  browserMode: BrowserMode;
  controlsLocked: boolean;
  maxResponseTurns: ResponseTurnBudget;
  onBrowserModeChange: (value: BrowserMode) => void;
  onMaxResponseTurnsChange: (value: ResponseTurnBudget) => void;
  onPromptChange: (value: string) => void;
  onScenarioChange: (value: string) => void;
  prompt: string;
  scenarios: ScenarioManifest[];
  selectedScenarioId: string;
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

function SegmentControl<T extends string>({
  ariaLabel,
  disabled,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <div aria-label={ariaLabel} className="segmentControl" role="tablist">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={`segmentButton ${value === option.value ? "isActive" : ""}`}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
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
  backendId,
  browserModes,
  browserMode,
  controlsLocked,
  maxResponseTurns,
  onBrowserModeChange,
  onMaxResponseTurnsChange,
  onPromptChange,
  onScenarioChange,
  prompt,
  scenarios,
  selectedScenarioId,
}: RunControlsProps) {
  return (
    <aside aria-label="Run controls" className="panel controlsPanel" id="controls-pane">
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
              Browser and turn budget
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
                text={browserHelpText(backendId)}
              />
            </div>
            {browserModes.length > 1 ? (
              <SegmentControl
                ariaLabel="Browser mode"
                disabled={controlsLocked}
                onChange={onBrowserModeChange}
                options={browserModes.map((value) => ({
                  label: value === "headless" ? "Headless" : "Visible", value,
                }))}
                value={browserMode}
              />
            ) : (
              <span className="advancedHint">{backendId === "python" ? "Visible desktop" : "Visible browser"}</span>
            )}
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
                min={1}
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

        </div>
      </details>

    </aside>
  );
}
