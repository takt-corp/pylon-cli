/**
 * `pylon config` — inspect and edit stored settings. The API token lives in
 * `~/.pylon/credentials.json`; the base URL lives in the config file.
 */

import { Command } from 'commander';
import { configPath, readConfig, writeConfig } from '../runtime/config.js';
import { credentialsPath, readCredentials, writeCredentials } from '../runtime/credentials.js';
import { printResult } from '../runtime/output.js';
import { UsageError } from '../runtime/errors.js';
import type { GlobalOptions } from '../runtime/command.js';

const SETTABLE_KEYS = ['token', 'base-url'] as const;

function maskToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function registerConfigCommand(program: Command): Command {
  const config = program.command('config').description('Inspect and edit stored configuration');

  config
    .command('path')
    .description('Print the paths to the credentials and config files')
    .action(function (this: Command) {
      const globals = this.optsWithGlobals() as GlobalOptions;
      printResult(
        { credentialsPath: credentialsPath(), configPath: configPath() },
        { pretty: globals.pretty },
      );
    });

  config
    .command('get')
    .description('Show stored settings (token masked)')
    .action(function (this: Command) {
      const globals = this.optsWithGlobals() as GlobalOptions;
      printResult(
        {
          token: maskToken(readCredentials().token),
          baseUrl: readConfig().baseUrl,
          credentialsPath: credentialsPath(),
          configPath: configPath(),
        },
        { pretty: globals.pretty },
      );
    });

  config
    .command('set')
    .description('Set a config value: token or base-url')
    .argument('<key>', `one of: ${SETTABLE_KEYS.join(', ')}`)
    .argument('<value>', 'value to store')
    .action(function (this: Command, key: string, value: string) {
      const globals = this.optsWithGlobals() as GlobalOptions;
      let path: string;
      if (key === 'token' || key === 'api-key') {
        path = writeCredentials({ token: value });
      } else if (key === 'base-url') {
        const stored = readConfig();
        stored.baseUrl = value;
        path = writeConfig(stored);
      } else {
        throw new UsageError(
          `Unknown config key "${key}". Use one of: ${SETTABLE_KEYS.join(', ')}.`,
        );
      }
      printResult({ ok: true, path, key }, { pretty: globals.pretty });
    });

  return config;
}
