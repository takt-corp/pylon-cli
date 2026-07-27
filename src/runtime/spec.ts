/**
 * Shared metadata types describing Pylon API operations as CLI commands.
 *
 * The generator (`scripts/generate.ts`) emits `src/generated/operations.ts`
 * as an array of {@link OperationSpec}; the runtime consumes that array to
 * build the commander command tree. Keeping the shape here means the generated
 * output stays a pure data file with no logic.
 */

/** How a single flag's value is parsed and where it is sent in the request. */
export type FlagKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'string-array'
  | 'number-array'
  | 'json'
  | 'file'
  | 'file-array';

/** Where a flag's value ends up in the outgoing HTTP request. */
export type FlagSource = 'path' | 'query' | 'body';

/** A single CLI flag derived from an API parameter or request-body property. */
export interface FlagSpec {
  /** Canonical kebab-case flag name, e.g. `account-id`. */
  name: string;
  /** Help text shown for the flag. */
  description: string;
  /** Whether the operation cannot run without this flag. */
  required: boolean;
  /** How the raw string value is coerced. */
  kind: FlagKind;
  /** Which part of the request this flag feeds. */
  source: FlagSource;
  /** Original key name (path param, query param, or body property). */
  target: string;
}

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** A fully described API operation, ready to be turned into a CLI command. */
export interface OperationSpec {
  /** Stable Pylon operationId, e.g. `CreateIssue`. Used as a command alias. */
  operationId: string;
  /** Module (command group) the operation belongs to, e.g. `issues`. */
  module: string;
  /** Subcommand name within the module, e.g. `create`. */
  command: string;
  method: HttpMethod;
  /** Templated path, e.g. `/issues/{id}/reply`. */
  path: string;
  summary: string;
  description: string;
  /** Names of `{...}` placeholders in `path`, in order. */
  pathParams: string[];
  /** Whether the operation accepts a request body. */
  hasBody: boolean;
  /** Content type of the request body, when `hasBody`. */
  bodyContentType: 'application/json' | 'multipart/form-data' | null;
  /** True when the operation supports cursor pagination (`cursor` + `limit`). */
  paginated: boolean;
  /** True when the operation uploads files (multipart `--file`). */
  fileUpload: boolean;
  /** All flags for the operation. */
  flags: FlagSpec[];
}
