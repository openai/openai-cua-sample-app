import { type RunnerErrorResponse } from "@cua-sample/replay-schema";

type RunnerCoreErrorOptions = {
  code?: string;
  hint?: string;
  statusCode?: number;
};

export class RunnerCoreError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly statusCode: number;

  constructor(message: string, options: RunnerCoreErrorOptions = {}) {
    super(message);
    this.name = "RunnerCoreError";
    this.code = options.code ?? "runner_error";
    this.statusCode = options.statusCode ?? 500;

    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }
}

export function toRunnerErrorResponse(error: RunnerCoreError): RunnerErrorResponse {
  return {
    code: error.code,
    error: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
  };
}
