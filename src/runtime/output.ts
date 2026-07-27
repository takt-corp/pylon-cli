/**
 * Output helpers. Success payloads go to stdout as JSON; errors go to stderr as
 * a `{ error: {...} }` JSON object. Keeping all output machine-readable makes
 * the CLI predictable for agents to parse.
 */

import { CliError, ExitCode } from './errors.js';

export interface Writer {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const defaultWriter: Writer = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

function serialize(value: unknown, pretty: boolean): string {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

/** Print a successful result as JSON on stdout. */
export function printResult(
  value: unknown,
  options: { pretty?: boolean; writer?: Writer } = {},
): void {
  const writer = options.writer ?? defaultWriter;
  // `undefined` (e.g. 204 No Content) serializes to `null` for valid JSON.
  const normalized = value === undefined ? null : value;
  writer.out(`${serialize(normalized, options.pretty ?? false)}\n`);
}

/** Render an error as JSON on stderr and return its exit code. */
export function printError(
  error: unknown,
  options: { pretty?: boolean; writer?: Writer } = {},
): number {
  const writer = options.writer ?? defaultWriter;
  const cliError =
    error instanceof CliError
      ? error
      : new CliError(error instanceof Error ? error.message : String(error));

  const payload = { error: cliError.toPayload() };
  writer.err(`${serialize(payload, options.pretty ?? false)}\n`);
  return cliError.exitCode ?? ExitCode.Failure;
}
