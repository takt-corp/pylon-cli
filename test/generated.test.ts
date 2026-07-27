import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { OPERATIONS, MODULES } from '../src/generated/operations.js';

const specPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
};

function specOperationIds(): string[] {
  const ids: string[] = [];
  for (const methods of Object.values(spec.paths)) {
    for (const op of Object.values(methods)) {
      if (op && typeof op === 'object' && op.operationId) ids.push(op.operationId);
    }
  }
  return ids;
}

describe('generated operation coverage', () => {
  it('registers every operation in the spec exactly once', () => {
    const specIds = specOperationIds().sort();
    const genIds = OPERATIONS.map((o) => o.operationId).sort();
    expect(genIds).toEqual(specIds);
    expect(new Set(genIds).size).toBe(genIds.length);
  });

  it('covers all 23 requested modules', () => {
    expect(MODULES).toHaveLength(23);
    const moduleNames = new Set(MODULES.map((m) => m.name));
    for (const op of OPERATIONS) {
      expect(moduleNames.has(op.module)).toBe(true);
    }
  });

  it('has unique command names and aliases within each module', () => {
    for (const module of MODULES) {
      const ops = OPERATIONS.filter((o) => o.module === module.name);
      const names = new Set<string>();
      for (const op of ops) {
        const candidates = [op.command, op.operationId, op.shortAlias].filter(Boolean) as string[];
        for (const name of candidates) {
          expect(names.has(name), `duplicate "${name}" in ${module.name}`).toBe(false);
          names.add(name);
        }
      }
    }
  });

  it('marks every path parameter as a required flag', () => {
    for (const op of OPERATIONS) {
      for (const param of op.pathParams) {
        const flag = op.flags.find((f) => f.source === 'path' && f.target === param);
        expect(flag, `${op.operationId} missing path flag ${param}`).toBeTruthy();
        expect(flag?.required).toBe(true);
      }
    }
  });

  it('flags file-upload operations with multipart content type', () => {
    for (const op of OPERATIONS) {
      if (op.fileUpload) {
        expect(op.bodyContentType).toBe('multipart/form-data');
        expect(op.flags.some((f) => f.kind === 'file' || f.kind === 'file-array')).toBe(true);
      }
    }
  });
});
