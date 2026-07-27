/**
 * Turn an {@link OperationSpec} into a commander subcommand. All operation
 * commands share this builder, so behavior (auth, flag coercion, pagination,
 * multipart, JSON output) is defined once and exercised by tests.
 */

import { Command, Option } from 'commander';
import type { OperationSpec, FlagSpec } from './spec.js';
import { PylonClient } from './client.js';
import { resolveConfig } from './config.js';
import { buildRequest, parseDataOption } from './flags.js';
import { buildFormData } from './multipart.js';
import { fetchAllPages } from './pagination.js';
import { resolveDataInput } from './io.js';
import { printResult } from './output.js';

/** Global options declared on the root program and inherited by subcommands. */
export interface GlobalOptions {
  token?: string;
  apiKey?: string;
  baseUrl?: string;
  pretty?: boolean;
  all?: boolean;
  data?: string;
  verbose?: boolean;
}

/** Dependencies injectable for testing (defaults use the real implementations). */
export interface CommandDeps {
  createClient?: (options: GlobalOptions) => PylonClient;
  onResult?: (value: unknown, options: GlobalOptions) => void;
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

function addFlagOption(command: Command, flag: FlagSpec): void {
  const takesArray =
    flag.kind === 'string-array' || flag.kind === 'number-array' || flag.kind === 'file-array';
  const placeholder = flag.kind === 'boolean' ? '<true|false>' : '<value>';
  const description = flag.required ? `${flag.description} (required)` : flag.description;
  const option = new Option(`--${flag.name} ${placeholder}`, description);
  if (takesArray) option.argParser(collect);
  command.addOption(option);
}

function defaultCreateClient(options: GlobalOptions): PylonClient {
  const { apiKey, baseUrl } = resolveConfig({
    token: options.token ?? options.apiKey,
    baseUrl: options.baseUrl,
  });
  return new PylonClient({ apiKey, baseUrl, verbose: options.verbose });
}

/**
 * Configure an existing command to execute `op`: add its flags and action.
 * Used both for per-operation subcommands and for single-operation modules
 * where the operation runs directly off the module command.
 */
export function configureOperation(
  command: Command,
  op: OperationSpec,
  deps: CommandDeps = {},
): Command {
  command.description(op.summary || op.description || op.operationId);
  for (const flag of op.flags) addFlagOption(command, flag);

  command.action(async function actionHandler(this: Command) {
    const globals = this.optsWithGlobals() as GlobalOptions & Record<string, unknown>;
    const localOptions = this.opts();

    // Only touch --data (and stdin/@file) for operations that accept a body,
    // so `--data -` on a bodyless GET does not block reading stdin.
    const data = op.hasBody ? parseDataOption(resolveDataInput(globals.data)) : {};

    const { request, body } = buildRequest(op, { options: localOptions, data });

    const client = (deps.createClient ?? defaultCreateClient)(globals);

    let result: unknown;
    if (op.fileUpload || op.bodyContentType === 'multipart/form-data') {
      result = await client.request({ ...request, form: buildFormData(op, body) });
    } else if (op.paginated && globals.all) {
      result = await fetchAllPages(client, request);
    } else {
      result = await client.request(request);
    }

    if (deps.onResult) {
      deps.onResult(result, globals);
    } else {
      printResult(result, { pretty: globals.pretty });
    }
  });

  return command;
}

/** Register one operation as a subcommand under `parent` (name + operationId alias). */
export function addOperationCommand(
  parent: Command,
  op: OperationSpec,
  deps: CommandDeps = {},
): Command {
  const command = parent.command(op.command).alias(op.operationId);
  return configureOperation(command, op, deps);
}
