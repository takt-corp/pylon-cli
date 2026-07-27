import { describe, it, expect } from 'vitest';
import { coerceFlag, buildRequest, parseDataOption, camelCase } from '../../src/runtime/flags.js';
import { UsageError } from '../../src/runtime/errors.js';
import type { FlagSpec, OperationSpec } from '../../src/runtime/spec.js';

const flag = (over: Partial<FlagSpec>): FlagSpec => ({
  name: 'x',
  description: '',
  required: false,
  kind: 'string',
  source: 'body',
  target: 'x',
  ...over,
});

describe('camelCase', () => {
  it('converts kebab to camel', () => {
    expect(camelCase('account-id')).toBe('accountId');
    expect(camelCase('custom-fields-json')).toBe('customFieldsJson');
    expect(camelCase('id')).toBe('id');
  });
});

describe('coerceFlag', () => {
  it('coerces scalars', () => {
    expect(coerceFlag(flag({ kind: 'integer' }), '42')).toBe(42);
    expect(coerceFlag(flag({ kind: 'number' }), '3.5')).toBe(3.5);
    expect(coerceFlag(flag({ kind: 'boolean' }), 'true')).toBe(true);
    expect(coerceFlag(flag({ kind: 'boolean' }), 'no')).toBe(false);
    expect(coerceFlag(flag({ kind: 'string' }), 7)).toBe('7');
  });

  it('coerces arrays and json', () => {
    expect(coerceFlag(flag({ kind: 'string-array' }), ['a', 'b'])).toEqual(['a', 'b']);
    expect(coerceFlag(flag({ kind: 'number-array' }), ['1', '2'])).toEqual([1, 2]);
    expect(coerceFlag(flag({ kind: 'json' }), '{"a":1}')).toEqual({ a: 1 });
  });

  it('throws on invalid values', () => {
    expect(() => coerceFlag(flag({ kind: 'integer' }), 'nope')).toThrow(UsageError);
    expect(() => coerceFlag(flag({ kind: 'boolean' }), 'maybe')).toThrow(UsageError);
    expect(() => coerceFlag(flag({ kind: 'json' }), '{bad')).toThrow(UsageError);
  });

  it('rejects loose numeric input that Number() would accept', () => {
    for (const bad of ['', '  ', '0x10', '1e3', 'Infinity', 'NaN', '5px']) {
      expect(() => coerceFlag(flag({ kind: 'integer' }), bad)).toThrow(UsageError);
    }
    for (const bad of ['', '0x10', 'Infinity', 'abc']) {
      expect(() => coerceFlag(flag({ kind: 'number' }), bad)).toThrow(UsageError);
    }
    // Valid forms still parse.
    expect(coerceFlag(flag({ kind: 'integer' }), '-42')).toBe(-42);
    expect(coerceFlag(flag({ kind: 'number' }), '3.5')).toBe(3.5);
    expect(coerceFlag(flag({ kind: 'number' }), '1e3')).toBe(1000);
  });
});

describe('parseDataOption', () => {
  it('parses a JSON object', () => {
    expect(parseDataOption('{"a":1}')).toEqual({ a: 1 });
  });
  it('rejects non-objects', () => {
    expect(() => parseDataOption('[1,2]')).toThrow(UsageError);
    expect(() => parseDataOption('bad')).toThrow(UsageError);
  });
  it('returns empty object for undefined', () => {
    expect(parseDataOption(undefined)).toEqual({});
  });
});

const op = (flags: FlagSpec[], over: Partial<OperationSpec> = {}): OperationSpec => ({
  operationId: 'Op',
  module: 'm',
  command: 'op',
  method: 'post',
  path: '/things/{id}',
  summary: '',
  description: '',
  pathParams: ['id'],
  hasBody: true,
  bodyContentType: 'application/json',
  paginated: false,
  fileUpload: false,
  flags,
  ...over,
});

describe('buildRequest', () => {
  it('routes flags to path, query, and body', () => {
    const spec = op([
      flag({ name: 'id', source: 'path', target: 'id', required: true }),
      flag({ name: 'limit', source: 'query', target: 'limit', kind: 'integer' }),
      flag({ name: 'title', source: 'body', target: 'title', required: true }),
    ]);
    const { request, body } = buildRequest(spec, {
      options: { id: '7', limit: '5', title: 'Hi' },
    });
    expect(request.pathParams).toEqual({ id: '7' });
    expect(request.query).toEqual({ limit: 5 });
    expect(body).toEqual({ title: 'Hi' });
    expect(request.body).toEqual({ title: 'Hi' });
  });

  it('merges --data and lets flags override', () => {
    const spec = op([flag({ name: 'title', target: 'title' })]);
    const { body } = buildRequest(spec, {
      options: { title: 'Override' },
      data: { title: 'Base', extra: true },
    });
    expect(body).toEqual({ title: 'Override', extra: true });
  });

  it('treats a value from --data as satisfying a required body flag', () => {
    const spec = op([flag({ name: 'title', target: 'title', required: true })]);
    expect(() => buildRequest(spec, { options: {}, data: { title: 'x' } })).not.toThrow();
  });

  it('throws UsageError listing all missing required flags', () => {
    const spec = op([
      flag({ name: 'id', source: 'path', target: 'id', required: true }),
      flag({ name: 'title', target: 'title', required: true }),
    ]);
    expect(() => buildRequest(spec, { options: {} })).toThrow(/--id.*--title|--title.*--id/);
  });
});
