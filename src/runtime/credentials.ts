/**
 * API token storage and resolution.
 *
 * The token lives in `~/.pylon/credentials.json` (written by `pylon init`).
 * Resolution precedence, per the CLI's contract:
 *   1. `~/.pylon/credentials.json`
 *   2. `PYLON_API_KEY` environment variable
 *   3. `--token` (or `--api-key`) flag
 *
 * The file is written with `0600` permissions since it holds a secret. Set
 * `PYLON_HOME` to override the base directory (used by tests).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const ENV_API_KEY = 'PYLON_API_KEY';

export interface StoredCredentials {
  token?: string;
}

/** Absolute path to the credentials file (`~/.pylon/credentials.json`). */
export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.PYLON_HOME?.trim() || homedir();
  return join(base, '.pylon', 'credentials.json');
}

/** Read stored credentials, returning an empty object if absent/invalid. */
export function readCredentials(env: NodeJS.ProcessEnv = process.env): StoredCredentials {
  const path = credentialsPath(env);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as StoredCredentials;
    return {};
  } catch {
    return {};
  }
}

/** Persist credentials, creating the directory and enforcing `0600`. */
export function writeCredentials(
  credentials: StoredCredentials,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path = credentialsPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies mode when creating the file; enforce it always.
  chmodSync(path, 0o600);
  return path;
}

/** Remove the credentials file. Returns whether a token was present. */
export function clearCredentials(env: NodeJS.ProcessEnv = process.env): {
  path: string;
  removed: boolean;
} {
  const path = credentialsPath(env);
  const removed = existsSync(path) && Boolean(readCredentials(env).token);
  if (existsSync(path)) rmSync(path, { force: true });
  return { path, removed };
}

export type TokenSource = 'file' | 'env' | 'flag' | 'none';

export interface TokenOptions {
  /** Token supplied via `--token`/`--api-key`. */
  token?: string;
  env?: NodeJS.ProcessEnv;
}

/** Report which source a resolved token would come from. */
export function tokenSource(options: TokenOptions = {}): TokenSource {
  const env = options.env ?? process.env;
  if (readCredentials(env).token?.trim()) return 'file';
  if (env[ENV_API_KEY]?.trim()) return 'env';
  if (options.token?.trim()) return 'flag';
  return 'none';
}

/**
 * Resolve the API token following the documented precedence
 * (credentials file → env var → flag), or `undefined` when none is set.
 */
export function resolveToken(options: TokenOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  return (
    readCredentials(env).token?.trim() ||
    env[ENV_API_KEY]?.trim() ||
    options.token?.trim() ||
    undefined
  );
}

/**
 * The token to *store* (for `init`/`auth login`): an explicit flag/argument or
 * the environment variable — never the file, which is the write target.
 */
export function explicitToken(options: TokenOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  return options.token?.trim() || env[ENV_API_KEY]?.trim() || undefined;
}
