/**
 * Domain errors carry a stable code and HTTP status. Actions translate them
 * into framework fail() calls so the UI and the agent both see the reason.
 */
export class ContractError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContractError";
  }
}

/** Raised by sandbox providers to simulate a lost response or slow read. */
export class ProviderTimeout extends Error {
  constructor(
    readonly provider: string,
    readonly operation: string,
    /** True when the provider applied the write before the response was lost. */
    readonly applied: boolean,
  ) {
    super(`${provider}.${operation} timed out`);
    this.name = "ProviderTimeout";
  }
}

/** Raised to simulate the execution worker crashing mid-run. */
export class WorkerInterrupted extends Error {
  constructor() {
    super("Execution worker interrupted");
    this.name = "WorkerInterrupted";
  }
}
