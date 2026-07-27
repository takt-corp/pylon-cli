import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages } from '../../src/runtime/pagination.js';
import type { PylonClient } from '../../src/runtime/client.js';

describe('fetchAllPages', () => {
  it('follows the cursor until has_next_page is false', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [1, 2], pagination: { cursor: 'c1', has_next_page: true } })
      .mockResolvedValueOnce({ data: [3], pagination: { cursor: 'c2', has_next_page: false } });
    const client = { request } as unknown as PylonClient;

    const result = await fetchAllPages(client, {
      method: 'get',
      path: '/issues',
      query: { limit: 2 },
    });

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    // Second call carries the cursor from the first page.
    expect(request.mock.calls[1]![0].query).toMatchObject({ limit: 2, cursor: 'c1' });
  });

  it('handles a single page with no next cursor', async () => {
    const request = vi.fn().mockResolvedValue({ data: [1], pagination: { has_next_page: false } });
    const client = { request } as unknown as PylonClient;
    const result = await fetchAllPages(client, { method: 'get', path: '/issues' });
    expect(result.data).toEqual([1]);
    expect(result.pages).toBe(1);
    expect(result.truncated).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('marks the result truncated when the server repeats a cursor', async () => {
    // Always claims another page and always hands back the same cursor.
    const request = vi
      .fn()
      .mockResolvedValue({ data: [1], pagination: { cursor: 'same', has_next_page: true } });
    const client = { request } as unknown as PylonClient;
    const result = await fetchAllPages(client, { method: 'get', path: '/issues' });
    expect(result.truncated).toBe(true);
    // Page 1 records the cursor; page 2 returns it again and we stop.
    expect(result.pages).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
