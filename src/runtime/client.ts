/**
 * Thin HTTP client over the global `fetch` (Node 20+). Handles auth headers,
 * path/query building, JSON and multipart bodies, retry/backoff on transient
 * failures, and mapping non-2xx responses to {@link ApiError}.
 */

import { ApiError, CliError } from './errors.js';

export interface ClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Number of retries for 429/5xx/network errors. Default 2. */
  maxRetries?: number;
  /** Base backoff in milliseconds. Default 500. */
  backoffMs?: number;
  /** Log request lines to stderr. */
  verbose?: boolean;
  /** Injectable fetch + sleep for testing. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable stderr logger for testing. */
  logger?: (line: string) => void;
}

export interface RequestSpec {
  method: string;
  /** Templated path such as `/issues/{id}/reply`. */
  path: string;
  /** Values for `{...}` placeholders in `path`. */
  pathParams?: Record<string, string | number>;
  /** Query string parameters. Arrays become repeated keys. */
  query?: Record<string, unknown>;
  /** JSON request body. Ignored when `form` is set. */
  body?: unknown;
  /** Multipart form body. Takes precedence over `body`. */
  form?: FormData;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class PylonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly verbose: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly logger: (line: string) => void;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffMs = options.backoffMs ?? 500;
    this.verbose = options.verbose ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.logger = options.logger ?? ((line) => process.stderr.write(`${line}\n`));
  }

  /** Build the absolute URL for a request (path substitution + query). */
  buildUrl(spec: RequestSpec): string {
    const path = spec.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
      const value = spec.pathParams?.[name];
      if (value === undefined || value === null || value === '') {
        throw new CliError(`Missing value for path parameter "${name}".`);
      }
      return encodeURIComponent(String(value));
    });

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Execute a request and return the parsed JSON payload (or `null`). */
  async request<T = unknown>(spec: RequestSpec): Promise<T> {
    const url = this.buildUrl(spec);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    let requestBody: string | FormData | undefined;
    if (spec.form) {
      requestBody = spec.form; // fetch sets the multipart boundary header.
    } else if (spec.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(spec.body);
    }

    if (this.verbose) this.logger(`> ${spec.method.toUpperCase()} ${url}`);

    let attempt = 0;
    // Retry loop for transient failures.
    for (;;) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: spec.method.toUpperCase(),
          headers,
          body: requestBody,
        });
      } catch (cause) {
        if (attempt < this.maxRetries) {
          await this.sleepImpl(this.backoff(attempt));
          attempt += 1;
          continue;
        }
        throw new CliError(`Network error: ${(cause as Error).message}`, {
          code: 'network_error',
          details: String(cause),
        });
      }

      if (this.verbose) this.logger(`< ${response.status} ${response.statusText}`);

      if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
        // Release the connection back to the pool before retrying.
        await response.body?.cancel().catch(() => {});
        const wait = this.retryAfter(response) ?? this.backoff(attempt);
        await this.sleepImpl(wait);
        attempt += 1;
        continue;
      }

      const payload = await this.readBody(response);
      if (!response.ok) {
        throw this.toApiError(response.status, payload);
      }
      return payload as T;
    }
  }

  private backoff(attempt: number): number {
    return this.backoffMs * 2 ** attempt;
  }

  private retryAfter(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (!header) return undefined;
    const seconds = Number(header);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    return text;
  }

  private toApiError(status: number, payload: unknown): ApiError {
    let message = `Request failed with status ${status}`;
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const candidate = record.message ?? record.error ?? record.errors;
      if (typeof candidate === 'string') message = candidate;
    } else if (typeof payload === 'string' && payload.trim()) {
      message = payload.trim();
    }
    return new ApiError(status, message, payload ?? undefined);
  }
}
