/**
 * Code generator: reads the vendored Pylon OpenAPI spec and emits
 *   - src/generated/types.ts       (openapi-typescript output)
 *   - src/generated/operations.ts  (OperationSpec[] + module metadata)
 *
 * Run with `pnpm generate`. The output is committed so the package is
 * inspectable and installs without a generation step. Re-running on an
 * unchanged spec produces no diff.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import openapiTS, { astToString } from 'openapi-typescript';
import type { FlagKind, FlagSpec, HttpMethod, OperationSpec } from '../src/runtime/spec.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = join(ROOT, 'openapi.json');
const OUT_DIR = join(ROOT, 'src', 'generated');

// ---------------------------------------------------------------------------
// Spec typing (only the parts we read)
// ---------------------------------------------------------------------------

interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
}

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: Schema;
}

interface Operation {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Schema }>;
  };
}

interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
}

// ---------------------------------------------------------------------------
// Module + command naming
// ---------------------------------------------------------------------------

/** Ordered module list with help descriptions (matches the requested modules). */
const MODULE_DESCRIPTIONS: Record<string, string> = {
  accounts: 'Manage accounts, highlights, relationships, and account files',
  activities: 'Log account activities and list activity types',
  attachments: 'Upload attachments',
  'audit-logs': 'Read and search audit logs',
  'call-recordings': 'Manage and search call recordings',
  contacts: 'Manage and import contacts',
  'custom-fields': 'Manage custom fields',
  'custom-objects': 'Manage custom objects and records',
  'feature-requests': 'Manage feature requests and portal visibility',
  issues: 'Manage issues: create, reply, note, snooze, threads, followers',
  'knowledge-base': 'Manage knowledge bases, articles, and collections',
  macros: 'Manage macros and macro groups',
  me: 'Get the currently authenticated user',
  messages: 'Read, delete, redact, and import issue messages',
  surveys: 'Read and search surveys and responses',
  tags: 'Manage tags',
  tasks: 'Manage tasks and task comments',
  projects: 'Manage projects and milestones',
  teams: 'Manage teams',
  'ticket-forms': 'Read ticket forms',
  'training-data': 'Manage AI training data and uploads',
  'user-roles': 'List user roles',
  users: 'Manage users',
};

const MODULE_ORDER = Object.keys(MODULE_DESCRIPTIONS);

function moduleFor(path: string): string {
  if (/^\/issues\/[^/]+\/messages/.test(path)) return 'messages';
  if (/^\/import\/issues\/[^/]+\/messages/.test(path)) return 'messages';
  if (path === '/activity-types' || /^\/accounts\/[^/]+\/activities/.test(path))
    return 'activities';
  if (path.startsWith('/accounts')) return 'accounts';
  if (path.startsWith('/attachments')) return 'attachments';
  if (path.startsWith('/audit-logs')) return 'audit-logs';
  if (path.startsWith('/call-recordings')) return 'call-recordings';
  if (path.startsWith('/contacts') || path === '/import/contacts') return 'contacts';
  if (path.startsWith('/custom-fields')) return 'custom-fields';
  if (path.startsWith('/custom-objects')) return 'custom-objects';
  if (path.startsWith('/feature-requests')) return 'feature-requests';
  if (path.startsWith('/knowledge-bases')) return 'knowledge-base';
  if (path.startsWith('/macros') || path === '/macro-groups') return 'macros';
  if (path === '/me') return 'me';
  if (path.startsWith('/surveys')) return 'surveys';
  if (path.startsWith('/tags')) return 'tags';
  if (path.startsWith('/tasks')) return 'tasks';
  if (path.startsWith('/projects') || path.startsWith('/milestones')) return 'projects';
  if (path.startsWith('/teams')) return 'teams';
  if (path.startsWith('/ticket-forms')) return 'ticket-forms';
  if (path.startsWith('/training-data')) return 'training-data';
  if (path.startsWith('/user-roles')) return 'user-roles';
  if (path.startsWith('/users')) return 'users';
  if (path === '/issue-statuses' || path.startsWith('/issues')) return 'issues';
  if (path === '/integrations/devin/disconnect') return 'issues';
  if (path.startsWith('/import')) return 'issues';
  throw new Error(`No module mapping for path: ${path}`);
}

/**
 * Flag names the CLI reserves: the root program's global options plus the
 * `--help`/`--version` commander adds automatically. Generated per-operation
 * flags must not reuse these or they would shadow the global option.
 */
const RESERVED_FLAG_NAMES = [
  'token',
  'api-key',
  'base-url',
  'data',
  'all',
  'pretty',
  'verbose',
  'help',
  'version',
];

function kebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function segmentsOf(path: string): { statics: string[]; params: string[]; endsWithParam: boolean } {
  const parts = path.split('/').filter(Boolean);
  const statics: string[] = [];
  const params: string[] = [];
  for (const part of parts) {
    if (part.startsWith('{')) params.push(part.slice(1, -1));
    else statics.push(part);
  }
  const last = parts[parts.length - 1] ?? '';
  return { statics, params, endsWithParam: last.startsWith('{') };
}

/** Short CRUD/search alias for a module's root resource, or undefined. */
function shortAlias(method: HttpMethod, path: string, rootSegment: string): string | undefined {
  const { statics, params } = segmentsOf(path);
  if (statics[0] !== rootSegment) return undefined;
  if (path.endsWith('/search') && method === 'post') return 'search';
  const tail = statics.slice(1);
  if (tail.length > 0) return undefined; // sub-resource, no short alias
  if (method === 'get' && params.length === 0) return 'list';
  if (method === 'get' && params.length === 1) return 'get';
  if (method === 'post' && params.length === 0) return 'create';
  if (method === 'patch' && params.length === 1) return 'update';
  if (method === 'delete' && params.length === 1) return 'delete';
  return undefined;
}

// ---------------------------------------------------------------------------
// Schema resolution + flag classification
// ---------------------------------------------------------------------------

function makeResolver(schemas: Record<string, Schema>) {
  return function resolve(schema: Schema | undefined): Schema {
    if (!schema) return {};
    if (schema.$ref) {
      const name = schema.$ref.split('/').pop() as string;
      return resolve(schemas[name]);
    }
    if (schema.allOf) {
      const merged: Schema = { type: 'object', properties: {}, required: [] };
      for (const part of schema.allOf) {
        const r = resolve(part);
        Object.assign(merged.properties as object, r.properties ?? {});
        merged.required = [...(merged.required ?? []), ...(r.required ?? [])];
      }
      return merged;
    }
    return schema;
  };
}

function scalarKind(schema: Schema): FlagKind {
  switch (schema.type) {
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

function isBinary(schema: Schema): boolean {
  return schema.type === 'string' && schema.format === 'binary';
}

/**
 * Detect a multipart file field. Some fields carry `format: binary`; others
 * (e.g. training-data `files`) do not, so we also treat the conventional
 * `file`/`files` property names as uploads.
 */
function fileKindFor(prop: string, schema: Schema): FlagKind | null {
  if (isBinary(schema)) return 'file';
  if (schema.type === 'array' && isBinary(schema.items ?? {})) return 'file-array';
  if (prop === 'file') return 'file';
  if (prop === 'files') return 'file-array';
  return null;
}

interface FlagClassification {
  name: string;
  kind: FlagKind;
}

/** Classify a body property into a flag name + kind. */
function classifyBodyProp(prop: string, schema: Schema): FlagClassification {
  const base = kebab(prop);
  if (schema.type === 'array' && schema.items) {
    const items = schema.items;
    if (items.type === 'string' && !items.format) return { name: base, kind: 'string-array' };
    if (items.type === 'integer' || items.type === 'number') {
      return { name: base, kind: 'number-array' };
    }
    // Array of objects/refs -> JSON flag.
    return { name: `${base}-json`, kind: 'json' };
  }
  if (schema.$ref || schema.oneOf || schema.anyOf || schema.type === 'object' || !schema.type) {
    return { name: `${base}-json`, kind: 'json' };
  }
  return { name: base, kind: scalarKind(schema) };
}

// ---------------------------------------------------------------------------
// Build OperationSpec list
// ---------------------------------------------------------------------------

function buildOperations(spec: OpenApi): OperationSpec[] {
  const resolve = makeResolver(spec.components?.schemas ?? {});
  const rows: { path: string; method: HttpMethod; op: Operation }[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== 'object' || !op.operationId) continue;
      rows.push({ path, method: method as HttpMethod, op });
    }
  }

  // Determine each module's root resource segment (most common first static).
  const firstStatics: Record<string, Record<string, number>> = {};
  for (const { path } of rows) {
    const mod = moduleFor(path);
    const first = segmentsOf(path).statics[0] ?? '';
    (firstStatics[mod] ??= {})[first] ??= 0;
    firstStatics[mod][first] += 1;
  }
  const rootSegment: Record<string, string> = {};
  for (const [mod, counts] of Object.entries(firstStatics)) {
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    rootSegment[mod] = ranked[0]?.[0] ?? '';
  }

  const usedCommands: Record<string, Set<string>> = {};
  const operations: OperationSpec[] = [];

  for (const { path, method, op } of rows) {
    const module = moduleFor(path);
    const { params } = segmentsOf(path);
    const seen = (usedCommands[module] ??= new Set());

    // Primary command name from operationId, guaranteed unique per module.
    let command = kebab(op.operationId);
    while (seen.has(command)) command = `${command}-x`;
    seen.add(command);

    const flags: FlagSpec[] = [];
    // Seed with reserved names (global options + commander built-ins) so a body
    // or query field that kebabs to one of these is renamed instead of shadowing
    // it. `target` is preserved, so the request still sends the right key.
    const flagNames = new Set<string>(RESERVED_FLAG_NAMES);
    const addFlag = (flag: FlagSpec) => {
      let name = flag.name;
      while (flagNames.has(name)) name = `${name}-x`;
      flagNames.add(name);
      flags.push({ ...flag, name });
    };

    // Path parameters.
    for (const param of params) {
      addFlag({
        name: kebab(param),
        description: `Path parameter: ${param}`,
        required: true,
        kind: 'string',
        source: 'path',
        target: param,
      });
    }

    // Query parameters.
    let paginated = false;
    for (const param of op.parameters ?? []) {
      if (param.in !== 'query') continue;
      if (param.name === 'cursor') paginated = true;
      const schema = param.schema ?? {};
      let kind: FlagKind = 'string';
      if (schema.type === 'array') {
        kind = schema.items?.type === 'integer' ? 'number-array' : 'string-array';
      } else {
        kind = scalarKind(schema);
      }
      addFlag({
        name: kebab(param.name),
        description: param.description || `Query parameter: ${param.name}`,
        required: Boolean(param.required),
        kind,
        source: 'query',
        target: param.name,
      });
    }

    // Request body.
    const content = op.requestBody?.content ?? {};
    let hasBody = false;
    let bodyContentType: OperationSpec['bodyContentType'] = null;
    let fileUpload = false;

    if (content['application/json']) {
      hasBody = true;
      bodyContentType = 'application/json';
      const schema = resolve(content['application/json'].schema);
      const required = new Set(schema.required ?? []);
      for (const [prop, propSchema] of Object.entries(schema.properties ?? {})) {
        const { name, kind } = classifyBodyProp(prop, propSchema);
        addFlag({
          name,
          description: propSchema.description || `Body field: ${prop}`,
          required: required.has(prop),
          kind,
          source: 'body',
          target: prop,
        });
      }
    } else if (content['multipart/form-data']) {
      hasBody = true;
      bodyContentType = 'multipart/form-data';
      fileUpload = true;
      const schema = resolve(content['multipart/form-data'].schema);
      const required = new Set(schema.required ?? []);
      let namedFileFlag = false;
      for (const [prop, propSchema] of Object.entries(schema.properties ?? {})) {
        const fileKind = fileKindFor(prop, propSchema);
        if (fileKind) {
          const name = namedFileFlag ? kebab(prop) : 'file';
          namedFileFlag = true;
          addFlag({
            name,
            description: propSchema.description || `File to upload (${prop})`,
            required: required.has(prop),
            kind: fileKind,
            source: 'body',
            target: prop,
          });
        } else {
          const { name, kind } = classifyBodyProp(prop, propSchema);
          addFlag({
            name,
            description: propSchema.description || `Body field: ${prop}`,
            required: required.has(prop),
            kind,
            source: 'body',
            target: prop,
          });
        }
      }
    }

    operations.push({
      operationId: op.operationId,
      module,
      command,
      method,
      path,
      summary: (op.summary ?? '').trim(),
      description: (op.description ?? '').trim(),
      pathParams: params,
      hasBody,
      bodyContentType,
      paginated,
      fileUpload,
      flags,
    });

    // Attach short alias info via a side channel property on the object.
    const alias = shortAlias(method, path, rootSegment[module] ?? '');
    if (alias && !seen.has(alias)) {
      seen.add(alias);
      (operations[operations.length - 1] as OperationSpec & { shortAlias?: string }).shortAlias =
        alias;
    }
  }

  return operations;
}

// ---------------------------------------------------------------------------
// Emit files
// ---------------------------------------------------------------------------

function emitOperations(operations: OperationSpec[]): string {
  const modules = MODULE_ORDER.map(
    (name) =>
      `  { name: ${JSON.stringify(name)}, description: ${JSON.stringify(
        MODULE_DESCRIPTIONS[name],
      )} },`,
  ).join('\n');

  const ops = operations.map((op) => `  ${JSON.stringify(op)},`).join('\n');

  return `/* eslint-disable */
/**
 * AUTO-GENERATED by scripts/generate.ts. Do not edit by hand.
 * Regenerate with \`pnpm generate\`.
 */
import type { OperationSpec } from '../runtime/spec.js';

export interface ModuleInfo {
  name: string;
  description: string;
}

export const MODULES: ModuleInfo[] = [
${modules}
];

export type OperationSpecWithAlias = OperationSpec & { shortAlias?: string };

export const OPERATIONS: OperationSpecWithAlias[] = [
${ops}
];
`;
}

async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApi;

  mkdirSync(OUT_DIR, { recursive: true });

  // 1. Types from openapi-typescript.
  const ast = await openapiTS(new URL(`file://${SPEC_PATH}`));
  const types = `/* eslint-disable */\n/* AUTO-GENERATED by scripts/generate.ts. Do not edit. */\n${astToString(ast)}`;
  writeFileSync(join(OUT_DIR, 'types.ts'), types);

  // 2. Operations metadata.
  const operations = buildOperations(spec);
  writeFileSync(join(OUT_DIR, 'operations.ts'), emitOperations(operations));

  // 3. Format the metadata file (types.ts is prettier-ignored).
  execFileSync('npx', ['prettier', '--write', join(OUT_DIR, 'operations.ts')], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  const counts = operations.reduce<Record<string, number>>((acc, op) => {
    acc[op.module] = (acc[op.module] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Generated ${operations.length} operations across ${Object.keys(counts).length} modules.`,
  );
  console.log(`Types: ${join('src', 'generated', 'types.ts')}`);
  console.log(`Operations: ${join('src', 'generated', 'operations.ts')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
