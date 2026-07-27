/**
 * Translate parsed commander options into an HTTP {@link RequestSpec}.
 *
 * Path params, query params, and request-body properties each surface as a
 * flag (see {@link FlagSpec}). A raw `--data` payload can supply the whole body;
 * individual flags are merged on top and override matching keys.
 */

import type { FlagSpec, OperationSpec } from './spec.js';
import type { RequestSpec } from './client.js';
import { UsageError } from './errors.js';

/** Convert a kebab-case flag name to the camelCase key commander stores. */
export function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'off']);

function coerceBoolean(flag: FlagSpec, raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const value = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new UsageError(`Flag --${flag.name} expects a boolean (true/false), got "${raw}".`);
}

// Strict decimal patterns: reject empty strings, hex/octal/binary literals,
// whitespace-only input, and `Infinity`/`NaN` that `Number()` would accept.
const INTEGER_PATTERN = /^[+-]?\d+$/;
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function coerceInteger(flag: FlagSpec, raw: unknown): number {
  const text = String(raw).trim();
  const value = Number(text);
  if (!INTEGER_PATTERN.test(text) || !Number.isSafeInteger(value)) {
    throw new UsageError(`Flag --${flag.name} expects an integer, got "${raw}".`);
  }
  return value;
}

function coerceNumber(flag: FlagSpec, raw: unknown): number {
  const text = String(raw).trim();
  const value = Number(text);
  if (!NUMBER_PATTERN.test(text) || !Number.isFinite(value)) {
    throw new UsageError(`Flag --${flag.name} expects a number, got "${raw}".`);
  }
  return value;
}

function coerceJson(flag: FlagSpec, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new UsageError(
      `Flag --${flag.name} expects valid JSON: ${(cause as Error).message}`,
      raw,
    );
  }
}

function toArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [raw];
}

/** Coerce a single flag's raw commander value to its typed request value. */
export function coerceFlag(flag: FlagSpec, raw: unknown): unknown {
  switch (flag.kind) {
    case 'string':
      return String(raw);
    case 'integer':
      return coerceInteger(flag, raw);
    case 'number':
      return coerceNumber(flag, raw);
    case 'boolean':
      return coerceBoolean(flag, raw);
    case 'string-array':
      return toArray(raw).map((item) => String(item));
    case 'number-array':
      return toArray(raw).map((item) => coerceNumber(flag, item));
    case 'json':
      return coerceJson(flag, raw);
    case 'file':
      // Value is a local file path resolved later by the multipart builder.
      return String(Array.isArray(raw) ? raw[raw.length - 1] : raw);
    case 'file-array':
      return toArray(raw).map((item) => String(item));
    default:
      return raw;
  }
}

/** Parse the global `--data` payload into a request-body object. */
export function parseDataOption(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch (cause) {
    throw new UsageError(`--data must be valid JSON: ${(cause as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError('--data must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export interface BuildContext {
  /** camelCase-keyed options as returned by commander's `opts()`. */
  options: Record<string, unknown>;
  /** Already-parsed `--data` body (see {@link parseDataOption}). */
  data?: Record<string, unknown>;
}

export interface BuiltRequest {
  request: RequestSpec;
  /** Assembled body object (also used to build multipart form fields). */
  body: Record<string, unknown>;
}

/**
 * Assemble a {@link RequestSpec} from an operation and its parsed flags.
 * Validates that required flags are present (a value supplied via `--data`
 * satisfies a required body flag).
 */
export function buildRequest(op: OperationSpec, ctx: BuildContext): BuiltRequest {
  const options = ctx.options;
  const dataBody = ctx.data ?? {};
  const pathParams: Record<string, string | number> = {};
  const query: Record<string, unknown> = {};
  const body: Record<string, unknown> = { ...dataBody };
  const missing: string[] = [];

  for (const flag of op.flags) {
    const key = camelCase(flag.name);
    const raw = options[key];
    const provided = raw !== undefined && raw !== null;

    if (!provided) {
      const satisfiedByData = flag.source === 'body' && flag.target in dataBody;
      if (flag.required && !satisfiedByData) missing.push(`--${flag.name}`);
      continue;
    }

    const value = coerceFlag(flag, raw);
    switch (flag.source) {
      case 'path':
        pathParams[flag.target] = value as string | number;
        break;
      case 'query':
        query[flag.target] = value;
        break;
      case 'body':
        body[flag.target] = value;
        break;
    }
  }

  if (missing.length > 0) {
    throw new UsageError(`Missing required flag(s): ${missing.join(', ')}`);
  }

  const hasBody = op.hasBody && Object.keys(body).length > 0;
  const request: RequestSpec = {
    method: op.method,
    path: op.path,
    pathParams,
    query,
    body: hasBody && op.bodyContentType === 'application/json' ? body : undefined,
  };

  return { request, body };
}
