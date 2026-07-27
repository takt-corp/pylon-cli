/**
 * `pylon auth` — manage the stored API token. Pylon authenticates with a bearer
 * token (no OAuth2 flow in the API). `auth login` is equivalent to `pylon init`:
 * it stores a token in `~/.pylon/credentials.json`.
 */

import { Command, Option } from 'commander';
import { PylonClient } from '../runtime/client.js';
import {
  ENV_API_KEY,
  explicitToken,
  writeCredentials,
  clearCredentials,
  resolveToken,
  tokenSource,
  credentialsPath,
} from '../runtime/credentials.js';
import { resolveBaseUrl, readConfig, writeConfig } from '../runtime/config.js';
import { printResult } from '../runtime/output.js';
import { AuthError } from '../runtime/errors.js';
import type { GlobalOptions } from '../runtime/command.js';

export function registerAuthCommand(program: Command): Command {
  const auth = program.command('auth').description('Manage Pylon API credentials');

  auth
    .command('login')
    .description('Store an API token (from --token/--api-key or PYLON_API_KEY) and verify it')
    .addOption(new Option('--no-verify', 'skip verifying the token against GET /me'))
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals() as GlobalOptions;
      const local = this.opts() as { verify?: boolean };
      const token = explicitToken({ token: globals.token ?? globals.apiKey });
      if (!token) {
        throw new AuthError(`No token provided. Pass --token/--api-key or set ${ENV_API_KEY}.`);
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

  auth
    .command('status')
    .description('Show whether an API token is configured and its source')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals() as GlobalOptions;
      const flagToken = globals.token ?? globals.apiKey;
      const source = tokenSource({ token: flagToken });
      const apiKey = resolveToken({ token: flagToken });

      let user: unknown;
      let authenticated = false;
      if (apiKey) {
        const client = new PylonClient({
          apiKey,
          baseUrl: resolveBaseUrl(globals),
          verbose: globals.verbose,
          maxRetries: 0,
        });
        try {
          const me = await client.request<{ data?: unknown }>({ method: 'get', path: '/me' });
          user = me?.data ?? me;
          authenticated = true;
        } catch {
          authenticated = false;
        }
      }
      printResult(
        {
          configured: Boolean(apiKey),
          source,
          authenticated,
          credentialsPath: credentialsPath(),
          user,
        },
        { pretty: globals.pretty },
      );
    });

  auth
    .command('logout')
    .description('Remove the stored API token (~/.pylon/credentials.json)')
    .action(function (this: Command) {
      const globals = this.optsWithGlobals() as GlobalOptions;
      const { path, removed } = clearCredentials();
      printResult({ ok: true, removed, path }, { pretty: globals.pretty });
    });

  return auth;
}
