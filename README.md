# @takt/pylon-cli

An agent-friendly command line interface for the [Pylon API](https://docs.usepylon.com/pylon-docs/developer/api/api-reference).

`pylon` covers every one of the API's 136 operations across 23 modules —
generated directly from Pylon's OpenAPI spec, so it stays in sync as the API
evolves. Output is JSON on stdout, errors are JSON on stderr, and exit codes are
deterministic: everything a human or an automated agent needs to drive Pylon.

---

## Why we built this

- **We love Pylon.** It's one of the best customer support tools on the market,
  and it's where our support workflow lives.
- **Our business is increasingly driven by agents,** and Pylon's MCP support is
  still lacking for the automations we want to run.
- **We wanted an easy way to drive Pylon from desktop agents** like Claude and
  Codex — so we can automate triage, root-cause analysis (RCA), and reporting
  directly from the terminal.

---

## Getting started

### 1. Prerequisites

- **Node.js 20 or newer** (`node --version`).
- Optional: **pnpm** if you plan to work on the CLI itself.

On macOS, the easiest way to install Node.js is with [Homebrew](https://brew.sh/)
(see the [Homebrew install instructions](https://brew.sh/) to set up `brew`
first):

```bash
# Install the latest Node.js
brew install node

# …or pin to Node.js 24 (the latest LTS)
brew install node@24

# Verify
node --version
```

### 2. Install

```bash
# Global install (gives you the `pylon` command everywhere)
npm install -g @takt/pylon-cli

# …or run it on demand without installing
npx @takt/pylon-cli --help
```

Verify the install:

```bash
pylon --version
pylon --help
```

### 3. Get a Pylon API token

Pylon authenticates with a **bearer API token** (there is no OAuth flow). Create
one in the Pylon app under **Settings → API** and copy it — it looks like
`pyl_xxxxxxxx`. See the
[Pylon API reference](https://docs.usepylon.com/pylon-docs/developer/api/api-reference)
for details and the permissions your token grants.

### 4. Save your token

Run `init` once. It stores the token in `~/.pylon/credentials.json` (created with
`0600` permissions) and verifies it against the API before saving:

```bash
pylon init --token pyl_xxxxxxxx
```

Expected output:

```json
{ "ok": true, "path": "/Users/you/.pylon/credentials.json", "verified": true, "user": { ... } }
```

If verification fails you'll get a clear error and nothing is written:

```json
{ "error": { "message": "Token verification failed: ...", "code": "auth_error" } }
```

> Prefer to skip the network check (e.g. offline or in CI)? Add `--no-verify`.
> You can also pass the token positionally: `pylon init pyl_xxxxxxxx`.

### 5. Confirm you're connected

```bash
pylon auth status
pylon me
```

`pylon auth status` reports whether a token is configured and where it came
from; `pylon me` returns the authenticated organization and user. You're set —
jump to [Everyday usage](#everyday-usage).

---

## Configuring your token

The token is resolved from three sources, **in this order — first match wins**:

| Priority | Source                          | How to set it                                           |
| -------- | ------------------------------- | ------------------------------------------------------- |
| 1        | `~/.pylon/credentials.json`     | `pylon init --token <token>`                            |
| 2        | `PYLON_API_KEY` environment var | `export PYLON_API_KEY=<token>`                          |
| 3        | `--token <token>` flag          | `pylon <cmd> --token <token>` (`--api-key` is an alias) |

### Persisted file (recommended for local use)

```bash
pylon init --token pyl_xxxxxxxx      # write it
pylon auth status                    # source: "file"
pylon auth logout                    # remove ~/.pylon/credentials.json
```

Set `PYLON_HOME` to relocate the `~/.pylon` directory (handy for tests or
per-project credentials):

```bash
PYLON_HOME=./.secrets pylon init --token pyl_xxxxxxxx
```

### Environment variable (recommended for CI / containers)

```bash
export PYLON_API_KEY=pyl_xxxxxxxx
pylon me                             # no file needed
```

### Inline flag (one-off / overrides nothing persisted)

```bash
pylon me --token pyl_xxxxxxxx
```

> **Precedence note:** the stored file wins over the flag — a token in
> `~/.pylon/credentials.json` beats a `--token` passed on the command line.
> To force a different token for one command, run `pylon auth logout` first,
> or use an environment without the file (e.g. a fresh `PYLON_HOME`).

### Inspecting and editing configuration

```bash
pylon config path                    # where the credentials + config files live
pylon config get                     # show token (masked) and base URL
pylon config set token pyl_xxxxxxxx  # same as `pylon init --token`, no verification
pylon config set base-url https://api.usepylon.com
```

### Base URL

The (non-secret) API base URL lives separately in `~/.config/pylon/config.json`
and defaults to `https://api.usepylon.com`. Override it per command with
`--base-url`, for a session with `PYLON_BASE_URL`, or persist it with
`pylon config set base-url <url>` (or by passing `--base-url` to `pylon init`).

---

## Everyday usage

```
pylon <module> <command> [flags]
```

```bash
pylon me
pylon issues list --start-time 2026-01-01T00:00:00Z --end-time 2026-02-01T00:00:00Z --limit 50
pylon issues create-issue --title "Login broken" --body-html "<p>help</p>" --tags bug --tags urgent
pylon accounts get --id acc_123
pylon issues search-issues --data '{"filter":{"field":"state","operator":"equals","value":"open"}}'
```

Every command can be invoked three equivalent ways:

| Form                                        | Example                     |
| ------------------------------------------- | --------------------------- |
| Descriptive name (kebab of the operationId) | `pylon issues create-issue` |
| Short CRUD alias (root resources)           | `pylon issues create`       |
| Pylon `operationId`                         | `pylon issues CreateIssue`  |

Single-operation modules run directly: `pylon me`, `pylon user-roles`,
`pylon attachments`.

Discover everything with `--help` at any level:

```bash
pylon --help                        # list modules + global flags
pylon issues --help                 # list issue commands
pylon issues create-issue --help    # list flags for one command
```

## Flags

Path parameters, query parameters, and request-body fields all become flags,
derived from the spec:

- **Path params** → required flags, e.g. `--id`, `--account-id`.
- **Query params** → typed flags; required ones are enforced.
- **Body scalars** → typed flags. Booleans take an explicit value:
  `--customer-portal-visible true`.
- **Body arrays of scalars** → repeatable flags: `--tags bug --tags urgent`.
- **Body objects / nested structures** → a `--<field>-json` flag that takes JSON,
  e.g. `--custom-fields-json '[{"id":"..."}]'`.

### Request bodies

Build a body from flags, supply it whole with `--data`, or mix both (flags
override matching keys in `--data`):

```bash
# from flags
pylon issues create-issue --title "Login broken" --body-html "<p>help</p>" --tags bug

# from a JSON string
pylon issues search-issues --data '{"filter":{"field":"state","operator":"equals","value":"open"}}'

# from a file
pylon issues create-issue --data @issue.json

# from stdin
cat issue.json | pylon issues create-issue --data -
```

### File uploads

Multipart endpoints take `--file` (repeatable where the API allows multiple):

```bash
pylon attachments --file ./screenshot.png --description "repro"
pylon training-data upload-training-data-files --training-data-id td_1 --file a.pdf --file b.pdf
```

## Output & exit codes

Success prints JSON to stdout (add `--pretty` for indentation). Errors print
`{"error":{...}}` to stderr. Exit codes:

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | Success                                                            |
| `1`  | Generic failure                                                    |
| `2`  | Usage error (missing/invalid flags, unknown command)               |
| `3`  | Authentication error (missing or rejected token)                   |
| `4`  | API error (non-2xx response); `error.status` holds the HTTP status |

Example error:

```json
{ "error": { "status": 404, "message": "issue not found", "code": "api_error" } }
```

## Pagination

List endpoints accept `--cursor` and `--limit`. Add `--all` to follow the cursor
and return every page concatenated. The result reports how many pages were
fetched and whether it was cut short:

```bash
pylon issues list --start-time 2026-01-01T00:00:00Z --end-time 2026-02-01T00:00:00Z --all
# => {"data":[...all issues...],"pages":7,"truncated":false}
```

`truncated` is `true` only if iteration hit the safety cap or the server
repeated a cursor — always check it before treating the data as complete.

## Global flags

| Flag               | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `--token <token>`  | API token (lowest-precedence source; `--api-key` is an alias) |
| `--base-url <url>` | Override the API base URL                                     |
| `--data <json>`    | Request body as JSON, `@file`, or `-` for stdin               |
| `--all`            | Follow pagination and return every page                       |
| `--pretty`         | Pretty-print JSON output                                      |
| `--verbose`        | Log requests to stderr                                        |

## Modules

`accounts`, `activities`, `attachments`, `audit-logs`, `call-recordings`,
`contacts`, `custom-fields`, `custom-objects`, `feature-requests`, `issues`,
`knowledge-base`, `macros`, `me`, `messages`, `surveys`, `tags`, `tasks`,
`projects`, `teams`, `ticket-forms`, `training-data`, `user-roles`, `users`.

Run `pylon <module> --help` for the commands in each.

## Notes for agents

- Output is always valid JSON on stdout; parse stdout for results and stderr for
  errors, and branch on the exit code.
- Commands are deterministic and non-interactive — no prompts.
- Prefer the `operationId` form (e.g. `pylon issues CreateIssue`) when mapping
  from Pylon's API reference, since it matches the docs exactly.
- Use `--data` with `@file`/stdin for large or deeply nested request bodies.
- For unattended use, provide the token via `PYLON_API_KEY` rather than a file.

## Programmatic usage

```ts
import { PylonClient } from '@takt/pylon-cli';

const client = new PylonClient({
  apiKey: process.env.PYLON_API_KEY!,
  baseUrl: 'https://api.usepylon.com',
});
const me = await client.request({ method: 'get', path: '/me' });
```

## Development

```bash
pnpm install
pnpm generate     # regenerate src/generated/* from openapi.json
pnpm lint
pnpm typecheck
pnpm test         # vitest
pnpm build        # tsup -> dist/
```

The CLI is generated from the vendored `openapi.json`. To update it for a new
API version, replace `openapi.json` and run `pnpm generate`; the command tree,
flags, and types update automatically.

## License

MIT
