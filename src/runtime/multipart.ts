/**
 * Build a `multipart/form-data` body for file-upload endpoints. File flags
 * carry local paths which are read from disk and appended as file parts; all
 * other body values are appended as string (or repeated string) fields.
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { OperationSpec } from './spec.js';
import { UsageError } from './errors.js';

function appendFile(form: FormData, field: string, filePath: string): void {
  if (!existsSync(filePath)) {
    throw new UsageError(`File not found: ${filePath}`);
  }
  const buffer = readFileSync(filePath);
  // Copy into a fresh ArrayBuffer so Blob receives a plain ArrayBuffer.
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const file = new File([bytes], basename(filePath), {
    type: 'application/octet-stream',
  });
  form.append(field, file, basename(filePath));
}

function appendScalar(form: FormData, field: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined && item !== null) form.append(field, String(item));
    }
  } else {
    form.append(field, String(value));
  }
}

/**
 * Assemble a {@link FormData} from an operation's assembled body values.
 * `body` is the map produced by `buildRequest` (file flags hold paths).
 */
export function buildFormData(op: OperationSpec, body: Record<string, unknown>): FormData {
  const form = new FormData();
  const fileFlagTargets = new Map(
    op.flags
      .filter((flag) => flag.kind === 'file' || flag.kind === 'file-array')
      .map((flag) => [flag.target, flag.kind] as const),
  );

  for (const [field, value] of Object.entries(body)) {
    const fileKind = fileFlagTargets.get(field);
    if (fileKind) {
      const paths = Array.isArray(value) ? value : [value];
      if (fileKind === 'file' && paths.length > 1) {
        throw new UsageError(`Field "${field}" accepts a single file; got ${paths.length}.`);
      }
      for (const path of paths) appendFile(form, field, String(path));
    } else {
      appendScalar(form, field, value);
    }
  }

  return form;
}
