/**
 * `pylon init` — save a Pylon API token to `~/.pylon/credentials.json`.
 *
 * The token is taken from (in order) the positional argument, `--token`, or
 * `PYLON_API_KEY`. By default it is verified against `GET /me` before saving.
 */

import { Command, Option } from 'commander';
import { PylonClient } from '../runtime/client.js';
import { ENV_API_KEY, explicitToken, writeCredentials } from '../runtime/credentials.js';
import { resolveBaseUrl, readConfig, writeConfig } from '../runtime/config.js';
import { printResult } from '../runtime/output.js';
import { AuthError } from '../runtime/errors.js';
import type { GlobalOptions } from '../runtime/command.js';

export function registerInitCommand(program: Command): Command {
  return program
    .command('init')
    .description('Save a Pylon API token to ~/.pylon/credentials.json')
    .argument('[token]', 'API token (falls back to --token or PYLON_API_KEY)')
    .addOption(new Option('--no-verify', 'skip verifying the token against GET /me'))
    .action(async function (this: Command, positional: string | undefined) {
      const globals = this.optsWithGlobals() as GlobalOptions;
      const local = this.opts() as { verify?: boolean };

      const token = positional?.trim() || explicitToken({ token: globals.token ?? globals.apiKey });
      if (!token) {
        throw new AuthError(
          `No token provided. Pass it as an argument, via --token, or set ${ENV_API_KEY}.`,
        );
      }

      const baseUrl = resolveBaseUrl(globals);
      let user: unknown;
      if (local.verify !== false) {
        const client = new PylonClient({ apiKey: token, baseUrl, verbose: globals.verbose });
        try {
          const me = await client.request<{ data?: unknown }>({ method: 'get', path: '/me' });
          user = me?.data ?? me;
        } catch (cause) {
          throw new AuthError(`Token verification failed: ${(cause as Error).message}`);
        }
      }

      const path = writeCredentials({ token });
      // Persist an explicitly provided base URL so later commands use it too.
      if (globals.baseUrl) writeConfig({ ...readConfig(), baseUrl: globals.baseUrl });
      printResult(
        {
          ok: true,
          path,
          baseUrl: globals.baseUrl ? baseUrl : undefined,
          verified: local.verify !== false,
          user,
        },
        { pretty: globals.pretty },
      );
    });
}
