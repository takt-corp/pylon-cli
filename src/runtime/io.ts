/**
 * Input helpers for the global `--data` option, which accepts a literal JSON
 * string, `@path` to read a file, or `-` to read stdin.
 */

import { readFileSync } from 'node:fs';
import { UsageError } from './errors.js';

/** Resolve a `--data` argument to its raw JSON text. */
export function resolveDataInput(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === '-') {
    try {
      return readFileSync(0, 'utf8');
    } catch (cause) {
      throw new UsageError(`Failed to read --data from stdin: ${(cause as Error).message}`);
    }
  }
  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    try {
      return readFileSync(path, 'utf8');
    } catch (cause) {
      throw new UsageError(`Failed to read --data file "${path}": ${(cause as Error).message}`);
    }
  }
  return raw;
}
