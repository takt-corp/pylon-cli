/**
 * Base-URL configuration and combined credential resolution.
 *
 * The API token is handled by `credentials.ts` (`~/.pylon/credentials.json`).
 * Non-secret settings (base URL) live in `~/.config/pylon/config.json`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AuthError } from './errors.js';
import { ENV_API_KEY, resolveToken } from './credentials.js';

export { ENV_API_KEY };

export const DEFAULT_BASE_URL = 'https://api.usepylon.com';
export const ENV_BASE_URL = 'PYLON_BASE_URL';

export interface StoredConfig {
  baseUrl?: string;
}

/** Absolute path to the config file, honoring `XDG_CONFIG_HOME`. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'pylon', 'config.json');
}

/** Read the stored config file, returning an empty object if absent/invalid. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): StoredConfig {
  const path = configPath(env);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as StoredConfig;
    return {};
  } catch {
    return {};
  }
}

/** Persist config, creating the directory and enforcing `0600` on the file. */
export function writeConfig(config: StoredConfig, env: NodeJS.ProcessEnv = process.env): string {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies mode when creating the file; enforce it always.
  chmodSync(path, 0o600);
  return path;
}

export interface ResolveOptions {
  /** Token from `--token`/`--api-key`. */
  token?: string;
  /** Deprecated alias for `token`. */
  apiKey?: string;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
}

/** Resolve the base URL (no credential required). */
export function resolveBaseUrl(options: ResolveOptions = {}): string {
  const env = options.env ?? process.env;
  return (
    options.baseUrl?.trim() ||
    env[ENV_BASE_URL]?.trim() ||
    readConfig(env).baseUrl?.trim() ||
    DEFAULT_BASE_URL
  );
}

/** Resolve the API token (credentials file → env → flag), or `undefined`. */
export function resolveApiKey(options: ResolveOptions = {}): string | undefined {
  return resolveToken({ token: options.token ?? options.apiKey, env: options.env });
}

/** Resolve credentials, throwing an {@link AuthError} when no token is available. */
export function resolveConfig(options: ResolveOptions = {}): ResolvedConfig {
  const apiKey = resolveApiKey(options);
  if (!apiKey) {
    throw new AuthError(
      `No API token found. Run "pylon init --token <token>", set ${ENV_API_KEY}, or pass --token.`,
    );
  }
  return { apiKey, baseUrl: resolveBaseUrl(options) };
}
