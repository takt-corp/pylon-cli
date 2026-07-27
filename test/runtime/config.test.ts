import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configPath,
  readConfig,
  writeConfig,
  resolveBaseUrl,
  resolveConfig,
  DEFAULT_BASE_URL,
} from '../../src/runtime/config.js';
import { writeCredentials } from '../../src/runtime/credentials.js';
import { AuthError } from '../../src/runtime/errors.js';

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pylon-cfg-'));
  env = { XDG_CONFIG_HOME: dir, PYLON_HOME: dir };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('configPath', () => {
  it('honors XDG_CONFIG_HOME', () => {
    expect(configPath(env)).toBe(join(dir, 'pylon', 'config.json'));
  });
});

describe('read/write config (base URL)', () => {
  it('round-trips baseUrl', () => {
    writeConfig({ baseUrl: 'https://x' }, env);
    expect(readConfig(env)).toEqual({ baseUrl: 'https://x' });
  });

  it('returns empty object for missing files', () => {
    expect(readConfig(env)).toEqual({});
  });
});

describe('resolveBaseUrl', () => {
  it('defaults, then config, then env, then flag', () => {
    expect(resolveBaseUrl({ env })).toBe(DEFAULT_BASE_URL);
    writeConfig({ baseUrl: 'https://config' }, env);
    expect(resolveBaseUrl({ env })).toBe('https://config');
    expect(resolveBaseUrl({ env: { ...env, PYLON_BASE_URL: 'https://envurl' } })).toBe(
      'https://envurl',
    );
    expect(resolveBaseUrl({ baseUrl: 'https://flag', env })).toBe('https://flag');
  });
});

describe('resolveConfig', () => {
  it('throws AuthError when no token is available', () => {
    expect(() => resolveConfig({ env })).toThrow(AuthError);
  });

  it('resolves the token from the credentials file over the flag', () => {
    writeCredentials({ token: 'from-file' }, env);
    expect(resolveConfig({ token: 'from-flag', env })).toEqual({
      apiKey: 'from-file',
      baseUrl: DEFAULT_BASE_URL,
    });
  });

  it('falls back to the flag when nothing else is set', () => {
    expect(resolveConfig({ token: 'k', env })).toEqual({ apiKey: 'k', baseUrl: DEFAULT_BASE_URL });
  });
});
