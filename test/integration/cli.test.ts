import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../src/cli.js';
import type { CommandDeps } from '../../src/runtime/command.js';
import type { PylonClient, RequestSpec } from '../../src/runtime/client.js';

function harness() {
  const requests: RequestSpec[] = [];
  const results: unknown[] = [];
  const fakeClient = {
    request: async (spec: RequestSpec) => {
      requests.push(spec);
      return { ok: true, body: spec.body ?? null };
    },
  } as unknown as PylonClient;
  const deps: CommandDeps = {
    createClient: () => fakeClient,
    onResult: (value) => results.push(value),
  };
  return { requests, results, deps };
}

const argv = (...args: string[]) => ['node', 'pylon', ...args];

describe('cli integration', () => {
  it('runs GetIssue with a path param', async () => {
    const { requests, deps } = harness();
    const code = await run(argv('issues', 'get-issue', '--id', '42'), deps);
    expect(code).toBe(0);
    expect(requests[0]).toMatchObject({
      method: 'get',
      path: '/issues/{id}',
      pathParams: { id: '42' },
    });
  });

  it('supports the short alias and the operationId alias', async () => {
    const viaAlias = harness();
    expect(await run(argv('issues', 'get', '--id', '1'), viaAlias.deps)).toBe(0);
    expect(viaAlias.requests[0]?.path).toBe('/issues/{id}');

    const viaOpId = harness();
    expect(await run(argv('issues', 'GetIssue', '--id', '1'), viaOpId.deps)).toBe(0);
    expect(viaOpId.requests[0]?.path).toBe('/issues/{id}');
  });

  it('maps body flags to snake_case fields for CreateIssue', async () => {
    const { requests, deps } = harness();
    const code = await run(
      argv(
        'issues',
        'create-issue',
        '--title',
        'Login broken',
        '--body-html',
        '<p>help</p>',
        '--tags',
        'bug',
        '--tags',
        'urgent',
      ),
      deps,
    );
    expect(code).toBe(0);
    expect(requests[0]?.body).toEqual({
      title: 'Login broken',
      body_html: '<p>help</p>',
      tags: ['bug', 'urgent'],
    });
  });

  it('accepts a raw --data body for search', async () => {
    const { requests, deps } = harness();
    const code = await run(
      argv('issues', 'search-issues', '--data', '{"filter":{"field":"state"}}'),
      deps,
    );
    expect(code).toBe(0);
    expect(requests[0]).toMatchObject({ method: 'post', path: '/issues/search' });
    expect(requests[0]?.body).toEqual({ filter: { field: 'state' } });
  });

  it('runs single-operation module `me` directly', async () => {
    const { requests, deps } = harness();
    expect(await run(argv('me'), deps)).toBe(0);
    expect(requests[0]).toMatchObject({ method: 'get', path: '/me' });
  });

  it('coerces and sends query params for a list endpoint', async () => {
    const { requests, deps } = harness();
    const code = await run(
      argv(
        'issues',
        'list',
        '--start-time',
        '2026-01-01T00:00:00Z',
        '--end-time',
        '2026-02-01T00:00:00Z',
        '--limit',
        '5',
      ),
      deps,
    );
    expect(code).toBe(0);
    expect(requests[0]?.query).toMatchObject({
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-02-01T00:00:00Z',
      limit: 5,
    });
  });

  it('follows pagination with --all', async () => {
    const requests: RequestSpec[] = [];
    let call = 0;
    const fakeClient = {
      request: async (spec: RequestSpec) => {
        requests.push(spec);
        call += 1;
        return call === 1
          ? { data: [{ id: 1 }], pagination: { cursor: 'c1', has_next_page: true } }
          : { data: [{ id: 2 }], pagination: { cursor: 'c2', has_next_page: false } };
      },
    } as unknown as PylonClient;
    const results: unknown[] = [];
    const deps: CommandDeps = {
      createClient: () => fakeClient,
      onResult: (v) => results.push(v),
    };
    const code = await run(
      argv('issues', 'list', '--start-time', 'a', '--end-time', 'b', '--all'),
      deps,
    );
    expect(code).toBe(0);
    expect(results[0]).toEqual({ data: [{ id: 1 }, { id: 2 }], pages: 2, truncated: false });
    expect(requests).toHaveLength(2);
  });

  it('builds a multipart form for uploads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pylon-int-'));
    try {
      const file = join(dir, 'a.txt');
      writeFileSync(file, 'hello');
      const { requests, deps } = harness();
      const code = await run(argv('attachments', '--file', file, '--description', 'note'), deps);
      expect(code).toBe(0);
      expect(requests[0]?.form).toBeInstanceOf(FormData);
      expect((requests[0]?.form as FormData).get('description')).toBe('note');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns exit code 2 for missing required flags', async () => {
    const { results, deps } = harness();
    const code = await run(argv('issues', 'create-issue', '--title', 'only title'), deps);
    expect(code).toBe(2);
    expect(results).toHaveLength(0);
  });

  it('returns exit code 2 for unknown commands', async () => {
    const { deps } = harness();
    expect(await run(argv('bogus'), deps)).toBe(2);
  });

  describe('init', () => {
    async function withPylonHome(fn: (dir: string) => Promise<void>): Promise<void> {
      const dir = mkdtempSync(join(tmpdir(), 'pylon-init-'));
      const prev = process.env.PYLON_HOME;
      process.env.PYLON_HOME = dir;
      try {
        await fn(dir);
      } finally {
        if (prev === undefined) delete process.env.PYLON_HOME;
        else process.env.PYLON_HOME = prev;
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it('writes a positional token to ~/.pylon/credentials.json', async () => {
      await withPylonHome(async (dir) => {
        const { deps } = harness();
        const code = await run(argv('init', 'my-token', '--no-verify'), deps);
        expect(code).toBe(0);
        const file = join(dir, '.pylon', 'credentials.json');
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ token: 'my-token' });
      });
    });

    it('accepts the token via --token', async () => {
      await withPylonHome(async (dir) => {
        const { deps } = harness();
        const code = await run(argv('init', '--token', 'flag-token', '--no-verify'), deps);
        expect(code).toBe(0);
        const file = join(dir, '.pylon', 'credentials.json');
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ token: 'flag-token' });
      });
    });

    it('errors when no token is provided', async () => {
      await withPylonHome(async () => {
        const prevEnv = process.env.PYLON_API_KEY;
        delete process.env.PYLON_API_KEY;
        try {
          const { deps } = harness();
          expect(await run(argv('init', '--no-verify'), deps)).toBe(3);
        } finally {
          if (prevEnv !== undefined) process.env.PYLON_API_KEY = prevEnv;
        }
      });
    });
  });
});
