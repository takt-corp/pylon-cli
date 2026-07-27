/**
 * Structured error types. Every error surfaced to the user is a {@link CliError}
 * so the entrypoint can render it as JSON on stderr with a deterministic exit
 * code — important for agents driving the CLI programmatically.
 */

/** Exit codes used across the CLI. */
export const ExitCode = {
  Success: 0,
  /** Generic/unexpected failure. */
  Failure: 1,
  /** Bad usage: missing flags, invalid values, etc. */
  Usage: 2,
  /** Authentication problem (missing or rejected token). */
  Auth: 3,
  /** The API returned a non-2xx response. */
  Api: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export interface CliErrorPayload {
  status?: number;
  message: string;
  code?: string;
  details?: unknown;
}

/** Base class for all errors the CLI reports to the user. */
export class CliError extends Error {
  readonly exitCode: ExitCodeValue;
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      exitCode?: ExitCodeValue;
      status?: number;
      code?: string;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? ExitCode.Failure;
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }

  toPayload(): CliErrorPayload {
    return {
      status: this.status,
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

/** Invalid CLI usage (missing/invalid flags). Exit code 2. */
export class UsageError extends CliError {
  constructor(message: string, details?: unknown) {
    super(message, { exitCode: ExitCode.Usage, code: 'usage_error', details });
    this.name = 'UsageError';
  }
}

/** Missing or rejected credentials. Exit code 3. */
export class AuthError extends CliError {
  constructor(message: string, details?: unknown) {
    super(message, { exitCode: ExitCode.Auth, code: 'auth_error', details });
    this.name = 'AuthError';
  }
}

/** Non-2xx response from the Pylon API. Exit code 4. */
export class ApiError extends CliError {
  constructor(status: number, message: string, details?: unknown) {
    super(message, { exitCode: ExitCode.Api, status, code: 'api_error', details });
    this.name = 'ApiError';
  }
}
