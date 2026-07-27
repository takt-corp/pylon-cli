/**
 * Programmatic entrypoint. Exposes the HTTP client, config helpers, and the
 * generated operation metadata for consumers who want to embed the client
 * rather than shell out to the CLI.
 */

export { PylonClient } from './runtime/client.js';
export type { ClientOptions, RequestSpec } from './runtime/client.js';
export {
  resolveConfig,
  resolveApiKey,
  resolveBaseUrl,
  DEFAULT_BASE_URL,
} from './runtime/config.js';
export {
  ENV_API_KEY,
  credentialsPath,
  readCredentials,
  writeCredentials,
  clearCredentials,
  resolveToken,
} from './runtime/credentials.js';
export { CliError, ApiError, AuthError, UsageError, ExitCode } from './runtime/errors.js';
export type { OperationSpec, FlagSpec, FlagKind } from './runtime/spec.js';
export { OPERATIONS, MODULES } from './generated/operations.js';
export { buildProgram, run } from './cli.js';
