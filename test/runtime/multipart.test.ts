import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFormData } from '../../src/runtime/multipart.js';
import { UsageError } from '../../src/runtime/errors.js';
import type { OperationSpec, FlagSpec } from '../../src/runtime/spec.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pylon-mp-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const flag = (over: Partial<FlagSpec>): FlagSpec => ({
  name: 'x',
  description: '',
  required: false,
  kind: 'string',
  source: 'body',
  target: 'x',
  ...over,
});

const op = (flags: FlagSpec[]): OperationSpec => ({
  operationId: 'Upload',
  module: 'm',
  command: 'upload',
  method: 'post',
  path: '/upload',
  summary: '',
  description: '',
  pathParams: [],
  hasBody: true,
  bodyContentType: 'multipart/form-data',
  paginated: false,
  fileUpload: true,
  flags,
});

describe('buildFormData', () => {
  it('appends files and scalar fields', () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'hello');
    const spec = op([
      flag({ name: 'file', kind: 'file', target: 'file' }),
      flag({ name: 'description', kind: 'string', target: 'description' }),
    ]);
    const form = buildFormData(spec, { file, description: 'note' });
    const filePart = form.get('file') as File;
    expect(filePart).toBeInstanceOf(File);
    expect(filePart.name).toBe('a.txt');
    expect(form.get('description')).toBe('note');
  });

  it('appends multiple files for file-array fields', () => {
    const f1 = join(dir, 'a.txt');
    const f2 = join(dir, 'b.txt');
    writeFileSync(f1, '1');
    writeFileSync(f2, '2');
    const spec = op([flag({ name: 'file', kind: 'file-array', target: 'files' })]);
    const form = buildFormData(spec, { files: [f1, f2] });
    expect(form.getAll('files')).toHaveLength(2);
  });

  it('rejects a missing file', () => {
    const spec = op([flag({ name: 'file', kind: 'file', target: 'file' })]);
    expect(() => buildFormData(spec, { file: join(dir, 'nope.txt') })).toThrow(UsageError);
  });

  it('rejects multiple files for a single-file field', () => {
    const f1 = join(dir, 'a.txt');
    const f2 = join(dir, 'b.txt');
    writeFileSync(f1, '1');
    writeFileSync(f2, '2');
    const spec = op([flag({ name: 'file', kind: 'file', target: 'file' })]);
    expect(() => buildFormData(spec, { file: [f1, f2] })).toThrow(UsageError);
  });
});
