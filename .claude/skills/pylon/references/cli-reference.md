# Pylon CLI Reference

Complete command tree and behavioral detail for the `pylon` CLI (`@takt/pylon-cli`).
The CLI is generated from Pylon's OpenAPI spec and covers all 136 operations across
23 modules. This file is the offline map; `pylon <module> <command> --help` is the
live source of truth for exact flags on any command.

## Table of contents

- [Invocation model](#invocation-model)
- [Authentication & precedence](#authentication--precedence)
- [Output, exit codes, pagination](#output-exit-codes-pagination)
- [Request bodies & flags](#request-bodies--flags)
- [Search filter grammar](#search-filter-grammar)
- [Full command tree by module](#full-command-tree-by-module)

## Invocation model

```
pylon <module> <command> [flags]
```

Every command has three equivalent names — use whichever fits:

| Form                        | Example                     |
| --------------------------- | --------------------------- |
| Descriptive (kebab)         | `pylon issues create-issue` |
| Short CRUD alias (root)     | `pylon issues create`       |
| Pylon `operationId`         | `pylon issues CreateIssue`  |

Prefer the `operationId` form when mapping from Pylon's API docs — it matches
the reference exactly. Single-operation modules run directly: `pylon me`,
`pylon attachments`, `pylon user-roles`.

Discover anything with `--help`:

```bash
pylon --help                     # modules + global flags
pylon issues --help              # commands in a module
pylon issues create-issue --help # flags for one command
```

## Authentication & precedence

Bearer token only (no OAuth). Tokens look like `pyl_xxxxxxxx`, created in the
Pylon app under **Settings → API**.

Resolved in this order — **first match wins**:

| Priority | Source                          | Set with                                     |
| -------- | ------------------------------- | -------------------------------------------- |
| 1        | `~/.pylon/credentials.json`     | `pylon init --token <token>`                 |
| 2        | `PYLON_API_KEY` env var         | `export PYLON_API_KEY=<token>`               |
| 3        | `--token <token>` flag          | `pylon <cmd> --token <token>` (`--api-key`)  |

> The stored file beats `--token`. To force a different token, `pylon auth logout`
> first, or run in an env with a fresh `PYLON_HOME`.

Auth commands:

```bash
pylon init --token pyl_xxxx     # verify against GET /me, then write file (0600)
pylon init pyl_xxxx --no-verify # positional token, skip network check
pylon auth status               # is a token configured, and from which source
pylon auth login --token pyl_xxxx  # same as init
pylon auth logout               # remove ~/.pylon/credentials.json
pylon me                        # authenticated org + user
```

Config / base URL:

```bash
pylon config path               # where credentials + config live
pylon config get                # token (masked) + base URL
pylon config set token pyl_xxxx # no verification
pylon config set base-url https://api.usepylon.com
```

Env overrides: `PYLON_HOME` relocates `~/.pylon`; `PYLON_BASE_URL` sets the base
URL for a session; `--base-url` per command.

## Output, exit codes, pagination

- Success → JSON on **stdout**. Add `--pretty` for indentation.
- Errors → `{"error":{...}}` on **stderr**.
- `--verbose` logs requests to stderr.

Exit codes:

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| `0`  | Success                                            |
| `1`  | Generic failure                                    |
| `2`  | Usage error (bad/missing flags, unknown command)   |
| `3`  | Auth error (missing or rejected token)             |
| `4`  | API error (non-2xx); `error.status` = HTTP status  |

Pagination: list endpoints accept `--cursor` and `--limit`. Add `--all` to
follow the cursor and concatenate every page:

```bash
pylon issues list --start-time 2026-01-01T00:00:00Z --end-time 2026-02-01T00:00:00Z --all
# => {"data":[...],"pages":7,"truncated":false}
```

Always check `truncated` — `true` means iteration hit the safety cap or the
server repeated a cursor, so the data is incomplete.

## Request bodies & flags

Path params, query params, and body fields all become flags derived from the spec:

- **Path params** → required flags: `--id`, `--account-id`.
- **Query params** → typed flags; required ones enforced.
- **Body scalars** → typed flags. Booleans need an explicit value: `--customer-portal-visible true`.
- **Body arrays of scalars** → repeatable: `--tags bug --tags urgent`.
- **Body objects / nested** → a `--<field>-json` flag taking JSON: `--custom-fields-json '[{"id":"..."}]'`, `--filter-json '{...}'`.

Build a body from flags, supply it whole with `--data`, or mix (flags override
matching keys in `--data`):

```bash
pylon issues create-issue --title "Login broken" --body-html "<p>help</p>" --tags bug
pylon issues search-issues --data '{"filter":{...}}'
pylon issues create-issue --data @issue.json      # from a file
cat issue.json | pylon issues create-issue --data - # from stdin
```

File uploads (multipart) take `--file`, repeatable where allowed:

```bash
pylon attachments --file ./screenshot.png --description "repro"
pylon training-data upload-training-data-files --training-data-id td_1 --file a.pdf --file b.pdf
```

## Search filter grammar

`search-*` commands take a `--filter-json` (or the whole body via `--data`).
A filter is a node with a `field`, `operator`, and `value`; `and`/`or` nodes
take a `subfilters` array.

Operators: `equals`, `not_equals`, `contains`, `does_not_contain`, `in`,
`not_in`, `and`, `or`, `time_is_after`, `time_is_before`, `time_range`,
`string_contains`, `string_does_not_contain`, `is_set`, `is_unset`,
`greater_than`, `less_than`, `greater_than_or_equals`, `less_than_or_equals`.

Single condition:

```json
{ "filter": { "field": "state", "operator": "equals", "value": "open" } }
```

Compound (AND of two conditions):

```json
{ "filter": { "operator": "and", "subfilters": [
  { "field": "state", "operator": "equals", "value": "open" },
  { "field": "account_id", "operator": "equals", "value": "acc_123" }
] } }
```

`search-issues` also accepts `--search-text` for fuzzy matching, intersected
with any filter. Issue `state` is an org-configurable string, not a fixed enum —
run `pylon issues get-issue-statuses` to see the valid status values if a filter
returns nothing.

## Full command tree by module

23 modules. `pylon <module> --help` for live flags.

### issues — create, reply, note, snooze, threads, followers
- `get-issues` (`GetIssues`) — list; **requires** `--start-time`/`--end-time` (RFC3339, ≤30-day window); `--cursor`, `--limit` (default 20000)
- `search-issues` (`SearchIssues`) — `--filter-json`, `--search-text`, `--cursor`, `--limit` (default 100, <1000)
- `get-issue` (`GetIssue`) — by ID/number
- `create-issue`, `update-issue`, `delete-issue`, `import-issue`
- `create-issue-reply`, `create-issue-note`, `create-issue-ai-response`
- `create-issue-thread`, `get-issue-threads`
- `add-issue-followers`, `get-issue-followers`
- `snooze-issue`, `get-issue-statuses`
- `link-external-issue`, `get-issue-voice-calls`, `disconnect-devin`

### accounts — accounts, highlights, relationships, files
- `get-accounts`, `search-accounts`, `get-account`
- `create-account`, `update-account`, `update-accounts`, `delete-account`, `merge-accounts`
- `create-account-highlight`, `update-account-highlight`, `delete-account-highlight`
- `create-account-relationship`, `get-account-relationships`, `delete-account-relationship`
- `upload-account-file`

### contacts — manage & import
- `get-contacts`, `search-contacts`, `get-contact`
- `create-contact`, `update-contact`, `delete-contact`, `import-contact`

### messages — read, delete, redact, import
- `get-issue-messages`, `delete-message`, `redact-message`, `import-messages`

### tasks — tasks & comments
- `get-tasks`, `search-tasks`, `get-task`
- `create-task`, `update-task`, `delete-task`
- `get-task-comments`, `create-task-comment`, `update-task-comment`, `delete-task-comment`

### projects — projects & milestones
- `search-projects`, `get-project`, `create-project`, `update-project`, `delete-project`
- `get-milestone`, `create-milestone`, `update-milestone`, `delete-milestone`

### users — `get-users`, `search-users`, `get-user`, `update-user`
### teams — `get-teams`, `get-team`, `create-team`, `update-team`
### user-roles — list user roles (single op: `pylon user-roles`)
### me — authenticated user (single op: `pylon me`)

### tags — `get-tags`, `get-tag`, `create-tag`, `update-tag`, `delete-tag`
### macros — `get-macros`, `get-macro`, `create-macro`, `update-macro`, `get-macro-groups`
### custom-fields — `get-custom-fields`, `get-custom-field`, `create-custom-field`, `update-custom-field`
### custom-objects — `get-custom-objects`, `search-custom-objects`, `get-custom-object`, `create-`, `update-`, `update-custom-objects` (bulk), `delete-custom-object`
### feature-requests — `search-feature-requests`, `get-`, `create-`, `update-`, `delete-`, `set-feature-request-portal-visibility`
### surveys — `get-surveys`, `search-surveys`, `get-survey`, `get-survey-responses`
### call-recordings — `search-call-recordings`, `get-call-recording`, `update-call-recording`, `delete-call-recording`
### activities — `create-activity`, `get-activity-types`
### audit-logs — `get-audit-logs`, `search-audit-logs`
### ticket-forms — `get-ticket-forms`, `get-ticket-form`
### attachments — upload attachments (single op: `pylon attachments --file <f>`)
### knowledge-base — knowledge bases, collections, articles, route redirects
- `get-knowledge-bases`, `get-knowledge-base`
- `get-collections`, `get-collection`, `create-collection`, `update-collection`, `delete-collection`
- `get-articles`, `get-article`, `create-article`, `update-article`, `delete-article`, `request-article-review`
- `create-route-redirect`
### training-data — AI training data
- `list-training-data`, `get-training-data`, `create-training-data`
- `upload-training-data-files`, `upload-training-data-file-content`, `delete-training-data-documents`
