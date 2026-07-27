/**
 * Cursor pagination follower. Pylon list endpoints return
 * `{ data: [...], pagination: { cursor, has_next_page } }`; with `--all` we keep
 * requesting the next cursor until the API reports no more pages.
 */

import type { PylonClient, RequestSpec } from './client.js';

interface PaginatedResponse {
  data?: unknown[];
  pagination?: { cursor?: string; has_next_page?: boolean };
}

/** A safety cap so a misbehaving cursor cannot loop forever. */
const MAX_PAGES = 1000;

export interface PaginatedResult {
  data: unknown[];
  pages: number;
  /**
   * True when iteration stopped before the API said it was done — either the
   * page cap was hit or the server returned a cursor it had already served.
   * Callers must treat the data as incomplete when this is set.
   */
  truncated: boolean;
}

/**
 * Fetch every page for a paginated request and return a single envelope with
 * the concatenated `data` array, how many pages were fetched, and whether the
 * result was cut short.
 */
export async function fetchAllPages(
  client: PylonClient,
  request: RequestSpec,
): Promise<PaginatedResult> {
  const collected: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;

  for (;;) {
    const query = { ...(request.query ?? {}) };
    if (cursor) query.cursor = cursor;
    const response = await client.request<PaginatedResponse>({ ...request, query });
    pages += 1;

    if (Array.isArray(response?.data)) collected.push(...response.data);

    const next = response?.pagination;
    if (!next?.has_next_page || !next.cursor) break;

    // Stop (marking the result incomplete) on a repeated cursor or the cap so
    // a misbehaving server cannot loop forever or silently omit pages.
    if (seenCursors.has(next.cursor) || pages >= MAX_PAGES) {
      truncated = true;
      break;
    }
    seenCursors.add(next.cursor);
    cursor = next.cursor;
  }

  return { data: collected, pages, truncated };
}
