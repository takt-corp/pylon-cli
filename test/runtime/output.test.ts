import { describe, it, expect } from 'vitest';
import { printResult, printError, type Writer } from '../../src/runtime/output.js';
import { ApiError, AuthError, CliError } from '../../src/runtime/errors.js';

function makeWriter() {
  const out: string[] = [];
  const err: string[] = [];
  const writer: Writer = { out: (t) => out.push(t), err: (t) => err.push(t) };
  return { writer, out, err };
}

describe('printResult', () => {
  it('writes compact JSON to stdout', () => {
    const { writer, out } = makeWriter();
    printResult({ a: 1 }, { writer });
    expect(out.join('')).toBe('{"a":1}\n');
  });
  it('pretty-prints when requested', () => {
    const { writer, out } = makeWriter();
    printResult({ a: 1 }, { writer, pretty: true });
    expect(out.join('')).toBe('{\n  "a": 1\n}\n');
  });
  it('serializes undefined as null', () => {
    const { writer, out } = makeWriter();
    printResult(undefined, { writer });
    expect(out.join('')).toBe('null\n');
  });
});

describe('printError', () => {
  it('renders CliError payload and returns exit code', () => {
    const { writer, err } = makeWriter();
    const code = printError(new AuthError('nope'), { writer });
    expect(code).toBe(3);
    expect(JSON.parse(err.join(''))).toEqual({
      error: { message: 'nope', code: 'auth_error', status: undefined, details: undefined },
    });
  });

  it('includes status for ApiError', () => {
    const { writer, err } = makeWriter();
    const code = printError(new ApiError(404, 'missing'), { writer });
    expect(code).toBe(4);
    expect(JSON.parse(err.join('')).error).toMatchObject({ status: 404, message: 'missing' });
  });

  it('wraps unknown errors as generic CliError', () => {
    const { writer, err } = makeWriter();
    const code = printError(new Error('boom'), { writer });
    expect(code).toBe(1);
    expect(JSON.parse(err.join('')).error.message).toBe('boom');
  });

  it('passes through a plain CliError exit code', () => {
    const { writer } = makeWriter();
    expect(printError(new CliError('x'), { writer })).toBe(1);
  });
});
