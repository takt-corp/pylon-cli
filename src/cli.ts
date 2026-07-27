/**
 * CLI entrypoint. Builds the root `pylon` program from the generated operation
 * metadata, wires the `auth`/`config` commands, and turns every error into a
 * JSON payload on stderr with a deterministic exit code.
 */

import { readFileSync } from 'node:fs';
import { Command, CommanderError, Option } from 'commander';
import { OPERATIONS, MODULES } from './generated/operations.js';
import { addOperationCommand, configureOperation, type CommandDeps } from './runtime/command.js';
import { registerAuthCommand } from './commands/auth.js';
import { registerConfigCommand } from './commands/config.js';
import { registerInitCommand } from './commands/init.js';
import { printError } from './runtime/output.js';
import { UsageError } from './runtime/errors.js';

/**
 * Action for command groups: show help when invoked bare, but error on an
 * unrecognized subcommand (which commander otherwise passes through as an
 * operand because the group has an action).
 */
function helpOrUnknown(this: Command): void {
  if (this.args.length > 0) {
    throw new UsageError(`Unknown command: ${this.args[0]}`);
  }
  this.help();
}

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const DESCRIPTION = 'Agent-friendly command line interface for the Pylon API.';

/** Build the full commander program. `deps` are injectable for testing. */
export function buildProgram(deps: CommandDeps = {}): Command {
  const program = new Command('pylon')
    .description(DESCRIPTION)
    .version(version(), '-V, --version', 'output the CLI version')
    .configureHelp({ sortSubcommands: true })
    .addOption(new Option('--token <token>', 'Pylon API token (lowest precedence source)'))
    .addOption(new Option('--api-key <key>', 'Alias for --token'))
    .addOption(new Option('--base-url <url>', 'Override the API base URL'))
    .addOption(new Option('--data <json>', "Request body as JSON, '@file', or '-' for stdin"))
    .addOption(new Option('--all', 'Follow pagination and return every page of results'))
    .addOption(new Option('--pretty', 'Pretty-print JSON output'))
    .addOption(new Option('--verbose', 'Log requests to stderr'));

  program.action(helpOrUnknown);

  registerInitCommand(program);
  registerAuthCommand(program);
  registerConfigCommand(program);

  // One subcommand group per module, populated from generated metadata.
  for (const module of MODULES) {
    const group = program.command(module.name).description(module.description);
    const ops = OPERATIONS.filter((o) => o.module === module.name);

    if (ops.length === 1 && ops[0]) {
      // Single-operation modules run directly, e.g. `pylon me`.
      configureOperation(group, ops[0], deps);
      group.description(module.description);
    } else {
      group.action(helpOrUnknown);
      for (const op of ops) {
        const command = addOperationCommand(group, op, deps);
        if (op.shortAlias) command.alias(op.shortAlias);
      }
    }
  }

  return program;
}

/** Recursively convert commander's own exits into catchable throws. */
function overrideExits(command: Command): void {
  command.exitOverride();
  command.configureOutput({ writeErr: () => {} });
  for (const sub of command.commands) overrideExits(sub);
}

/** Parse argv and run. Returns the process exit code. */
export async function run(argv: string[] = process.argv, deps: CommandDeps = {}): Promise<number> {
  const program = buildProgram(deps);
  overrideExits(program);
  const pretty = argv.includes('--pretty');

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help/version already wrote to stdout; treat as success.
      if (error.exitCode === 0) return 0;
      const message = error.message.replace(/^error:\s*/i, '');
      return printError(new UsageError(message), { pretty });
    }
    return printError(error, { pretty });
  }
}
