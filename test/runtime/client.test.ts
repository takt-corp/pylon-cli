import { describe, it, expect, vi } from 'vitest';
import { PylonClient } from '../../src/runtime/client.js';
import { ApiError, CliError } from '../../src/runtime/errors.js';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const base = { apiKey: 'tok', baseUrl: 'https://api.usepylon.com' };

describe('buildUrl', () => {
  const client = new PylonClient(base);
  it('substitutes path params and encodes query', () => {
    const url = client.buildUrl({
      method: 'get',
      path: '/issues/{id}/messages',
      pathParams: { id: 'a b' },
      query: { limit: 5, tags: ['x', 'y'], skip: undefined },
    });
    expect(url).toBe('https://api.usepylon.com/issues/a%20b/messages?limit=5&tags=x&tags=y');
  });

  it('throws when a path param is missing', () => {
    expect(() => client.buildUrl({ method: 'get', path: '/issues/{id}', pathParams: {} })).toThrow(
      CliError,
    );
  });
});

describe('request', () => {
  it('sends bearer auth and JSON body, returns parsed payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: '1' } }));
    const client = new PylonClient({ ...base, fetchImpl });
    const result = await client.request({
      method: 'post',
      path: '/issues',
      body: { title: 'Hi' },
    });
    expect(result).toEqual({ data: { id: '1' } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.usepylon.com/issues');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ title: 'Hi' });
  });

  it('maps non-2xx responses to ApiError with the API message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { message: 'bad title' }));
    const client = new PylonClient({ ...base, fetchImpl, maxRetries: 0 });
    const error = (await client
      .request({ method: 'post', path: '/issues' })
      .catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.message).toBe('bad title');
  });

  it('retries retryable statuses then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { message: 'later' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const client = new PylonClient({ ...base, fetchImpl, sleepImpl, maxRetries: 2 });
    const result = await client.request({ method: 'get', path: '/me' });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'slow' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const client = new PylonClient({ ...base, fetchImpl, sleepImpl });
    await client.request({ method: 'get', path: '/me' });
    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it('retries network errors then throws CliError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const client = new PylonClient({ ...base, fetchImpl, sleepImpl, maxRetries: 1 });
    await expect(client.request({ method: 'get', path: '/me' })).rejects.toBeInstanceOf(CliError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
