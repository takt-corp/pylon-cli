import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  credentialsPath,
  readCredentials,
  writeCredentials,
  clearCredentials,
  resolveToken,
  explicitToken,
  tokenSource,
} from '../../src/runtime/credentials.js';

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pylon-cred-'));
  env = { PYLON_HOME: dir };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('credentialsPath', () => {
  it('resolves under PYLON_HOME/.pylon/credentials.json', () => {
    expect(credentialsPath(env)).toBe(join(dir, '.pylon', 'credentials.json'));
  });
});

describe('read/write/clear', () => {
  it('round-trips and writes 0600 perms', () => {
    const path = writeCredentials({ token: 'secret' }, env);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readCredentials(env)).toEqual({ token: 'secret' });
  });

  it('returns empty object for missing files', () => {
    expect(readCredentials(env)).toEqual({});
  });

  it('clears the credentials file', () => {
    writeCredentials({ token: 'secret' }, env);
    const result = clearCredentials(env);
    expect(result.removed).toBe(true);
    expect(existsSync(credentialsPath(env))).toBe(false);
    expect(clearCredentials(env).removed).toBe(false);
  });
});

describe('resolveToken precedence (file -> env -> flag)', () => {
  it('prefers the credentials file above all', () => {
    writeCredentials({ token: 'from-file' }, env);
    expect(resolveToken({ token: 'from-flag', env: { ...env, PYLON_API_KEY: 'from-env' } })).toBe(
      'from-file',
    );
  });

  it('uses the env var when the file is absent', () => {
    expect(resolveToken({ token: 'from-flag', env: { ...env, PYLON_API_KEY: 'from-env' } })).toBe(
      'from-env',
    );
  });

  it('falls back to the flag last', () => {
    expect(resolveToken({ token: 'from-flag', env })).toBe('from-flag');
  });

  it('returns undefined when nothing is set', () => {
    expect(resolveToken({ env })).toBeUndefined();
  });
});

describe('tokenSource', () => {
  it('reports the winning source', () => {
    expect(tokenSource({ env })).toBe('none');
    expect(tokenSource({ token: 'x', env })).toBe('flag');
    expect(tokenSource({ token: 'x', env: { ...env, PYLON_API_KEY: 'e' } })).toBe('env');
    writeCredentials({ token: 'f' }, env);
    expect(tokenSource({ token: 'x', env: { ...env, PYLON_API_KEY: 'e' } })).toBe('file');
  });
});

describe('explicitToken', () => {
  it('never reads the file, only flag or env', () => {
    writeCredentials({ token: 'from-file' }, env);
    expect(explicitToken({ token: 'from-flag', env })).toBe('from-flag');
    expect(explicitToken({ env: { ...env, PYLON_API_KEY: 'from-env' } })).toBe('from-env');
    expect(explicitToken({ env })).toBeUndefined();
  });
});
