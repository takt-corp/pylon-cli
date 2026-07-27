---
name: pylon
description: >-
  Expert operator of the `pylon` CLI (@takt/pylon-cli) for driving the Pylon
  support/customer-ops API from the terminal — issues (support tickets),
  accounts, contacts, tasks, projects, messages, knowledge base, macros, tags,
  users, teams, surveys, and more. Use whenever the user wants to read, search,
  create, reply to, update, snooze, or triage Pylon issues/tickets, look up a
  Pylon account or contact, run a Pylon search filter, or otherwise talk to
  Pylon from the command line — even if they just say "pull my open Pylon
  tickets", "reply to that customer in Pylon", "what's the status of account X",
  or reference a `pyl_` token. Handles installing the CLI and configuring the
  API token when they aren't set up yet.
---

# Pylon CLI

Drive Pylon from the terminal with the `pylon` command. This skill makes you an
expert at that CLI: getting it installed, authenticated, and then running the
right command with the right flags.

## Context you can read

Everything you need is bundled or lives beside the CLI. Read the deep reference
before guessing at commands or flags:

| What | Where | When to read it |
| --- | --- | --- |
| **How Pylon works** — data model, object graph, issue lifecycle, channels, search model, and *when to call which API* | `references/pylon-concepts.md` (next to this file) | Read this whenever the task needs judgment about *which* object/command to use — triage, "find the right ticket/account", multi-step work, or anything beyond a single obvious command. It's what turns a flag-runner into someone who understands Pylon. |
| Full command tree, auth precedence, exit codes, search grammar | `references/cli-reference.md` (next to this file) | First stop for the exact command/flag names across all 23 modules. |
| Canonical usage docs | `README.md` at the CLI repo root (`../../../README.md` from this skill; installed default `~/code/takt/pylon-cli/README.md`) | Concepts, precedence details, programmatic usage. |
| Exhaustive field-level detail | `openapi.json` at the CLI repo root (`../../../openapi.json`) | Only when `--help` and the reference don't pin down a field, enum, or nested body shape. It's ~490KB — grep it, don't read it whole. |

The **live source of truth is always `--help`**: `pylon <module> <command> --help`
prints the exact, current flags for that command. Reach for it whenever a
command's flags matter and you're not certain.

## Preflight: make sure the CLI works before running anything

Run a cheap check first. `pylon me` both proves the binary is on PATH and that
the token is valid — one command tells you which of the two setup steps (if any)
is missing.

```bash
pylon me
```

- **Success** (JSON with the org/user) → skip ahead to [Doing the work](#doing-the-work).
- **`command not found: pylon`** → [Install the CLI](#install-the-cli).
- **Exit code 3 / auth error** (`{"error":{...,"code":"auth_error"}}`) or
  `pylon auth status` shows no token → [Configure the token](#configure-the-token).

### Install the CLI

Requires **Node.js 20+** (`node --version`). Then, global install so `pylon` is
available everywhere:

```bash
npm install -g @takt/pylon-cli
```

Or, to avoid a global install, run it on demand — every `pylon ...` becomes
`npx @takt/pylon-cli ...`:

```bash
npx @takt/pylon-cli --help
```

Verify: `pylon --version` and `pylon --help`. If `npm install -g` fails on
permissions, don't sudo blindly — tell the user and suggest the `npx` form or
fixing their npm prefix.

### Configure the token

Pylon uses a bearer API token (looks like `pyl_xxxxxxxx`), created in the Pylon
app under **Settings → API**. If the user hasn't given you one, ask for it —
never invent or guess a token.

Save it once with `init`. It writes `~/.pylon/credentials.json` (`0600`) and
verifies against the API before saving, so a bad token fails loudly and writes
nothing:

```bash
pylon init --token pyl_xxxxxxxx
# => { "ok": true, "path": ".../credentials.json", "verified": true, "user": {...} }
```

Confirm with `pylon auth status` (should report `source: "file"`) and `pylon me`.

Alternatives, by situation:
- **CI / containers / unattended:** `export PYLON_API_KEY=pyl_xxxx` — no file needed.
- **One-off / overriding nothing:** `pylon <cmd> --token pyl_xxxx`.
- Precedence is file → env → flag (first match wins). A stored file **beats**
  `--token`; to force a different token, `pylon auth logout` first.

## Pylon's model in brief

Enough to orient; the full model and object graph are in
`references/pylon-concepts.md` — read it for any real triage or multi-step task.

Pylon is a B2B support + light-CRM platform. Two hubs anchor everything: the
**Issue** (a support ticket/conversation — the support hub) and the **Account**
(the customer *company* — the CRM hub); a **Contact** is a *person* at an account
and is the *requester* on issues, while a **User** is one of your own team members
(the AI agent is a User too). An issue carries messages, an assignee (User) and/or
routing **team**, tags, custom fields, and a `state` (its status). Issues embed
only thin "Mini" references to their account/contact/user — **fetch the full
object** (`accounts get-account`, `contacts get-contact`) when you need real
context. Custom fields extend records in place (keyed by slug); custom objects are
whole new record types. Post to an issue four ways: a customer-visible **reply**, an
internal **note**, an internal **thread**, or an **AI response** — know which the
user wants before sending. An **"internal note" is just an issue Message with
`is_private: true`** (a customer-visible reply is `is_private: false`) — so when the
user says "leave an internal note", that's `create-issue-note`, and when reading a
thread you can tell notes from replies by that flag.

## Confirm before you create or mutate anything

Treat every write as requiring a green light. **Before any command that creates,
updates, deletes, merges, snoozes, assigns, replies, notes, redacts, or otherwise
changes state in Pylon, show the user exactly what you're about to do — the command,
the target entity (by ID/number and name), and the payload — and get explicit
confirmation.** Read operations (`get-*`, `search-*`, `list-*`, `me`) need no
confirmation; run them freely to gather context. This isn't only for destructive
calls — creating a ticket, posting a reply, or reassigning is customer-visible and
often irreversible, so the same rule applies. When in doubt, it's a write: confirm.

## Doing the work

Command shape:

```
pylon <module> <command> [flags]
```

Each command has three interchangeable names — descriptive kebab
(`issues create-issue`), short CRUD alias (`issues create`), or the Pylon
`operationId` (`issues CreateIssue`). Prefer the `operationId` when a user
points you at Pylon's API docs, since it matches exactly.

Output is JSON on stdout (add `--pretty` for humans), errors are JSON on stderr,
and exit codes are deterministic (0 ok, 2 usage, 3 auth, 4 API). Branch on the
exit code; parse stdout for data and stderr for `error`. See
`references/cli-reference.md` for the full table and the complete command tree
across all 23 modules.

### Parsing Pylon URLs

Users routinely paste a Pylon web URL instead of an ID. Pull the identifier out of
the URL and map it to a command — don't ask them to restate it.

- **Issue URL** — the human-facing issue number lives in the `issueNumber` query
  param, not the path (the path's UUID is a *saved view*, not the issue):

  ```
  https://app.usepylon.com/support/issues/views/c5b91454-...-d546cf362c7c?issueNumber=2117
                                                     ^ view id (ignore)          ^ issue number
  ```

  → `pylon issues get-issue --id 2117`. `get-issue` accepts either the issue's UUID
  or its number in `--id`, so the number works directly. From that result you have
  the account/contact/assignee references to fetch next.

- General rule: grab the last path segment or the relevant query param as the ID,
  identify the entity type from the path (`/issues/`, `/accounts/`, `/contacts/`…),
  and call the matching `get-*`. If a URL is ambiguous, fetch and confirm the entity
  before acting on it.

### "Issues" means open issues

In Pylon an **issue is a support ticket**. When the user asks for "issues" (or
"tickets") without qualifying the state, they mean **open** ones — don't dump
closed/resolved history unless they ask.

Note the two list paths differ, and this matters:

- `pylon issues get-issues` lists by **time window only** (`--start-time` /
  `--end-time`, RFC3339, ≤30 days) — it does **not** filter by state.
- `pylon issues search-issues` takes a **filter**, which is how you scope to open.

So default to `search-issues` with a state filter. **"Open" isn't a single Pylon
status** — the built-in categories are `new`, `waiting_on_you`,
`waiting_on_customer`, `on_hold`, and `closed`, and orgs can add custom statuses
(only within on-hold/closed). Practically, "open" means *not closed*. **Confirm the
org's actual statuses first** with `pylon issues get-issue-statuses`, then filter —
excluding closed is the reliable move:

```bash
pylon issues get-issue-statuses          # discover this org's real status values
pylon issues search-issues \
  --filter-json '{"field":"state","operator":"not_equals","value":"closed"}' \
  --limit 100 --pretty
```

To scope further (e.g. one account, or only "on you"), wrap conditions in an `and`
node; the full filter grammar and operator list are in `references/cli-reference.md`
and `references/pylon-concepts.md`.

Only use `get-issues` when the user genuinely wants everything in a date range
(e.g. "all tickets in January") — and remember the 30-day cap, so chunk longer
spans and/or add `--all` to follow pagination.

### Building request bodies

Path/query/body fields are all flags. Scalars are typed flags (booleans need an
explicit value: `--customer-portal-visible true`); scalar arrays repeat
(`--tags bug --tags urgent`); nested objects use a `--<field>-json` flag. For
large or deeply nested bodies, prefer `--data @file.json` or piping via
`--data -`. Flags override matching keys in `--data`. Multipart endpoints take
`--file` (repeatable).

### Working habits that keep this reliable

- **Check `--help` before a command you haven't run**, rather than assuming flag
  names — the tree is generated from the spec and names are precise
  (`--account-id`, `--body-html`).
- **Read before you write.** For any update/delete/merge/redact/reassign, fetch
  the object first (`get-issue`, `get-account`) so you're acting on the right
  entity and can show the user what will change — then get the confirmation
  required by [Confirm before you create or mutate anything](#confirm-before-you-create-or-mutate-anything).
- **Check `truncated`** on any `--all` result before treating the data as
  complete (`true` = iteration was cut short).
- **Surface errors verbatim.** On a non-zero exit, show the `error` JSON and its
  `status`/`code` rather than paraphrasing — the codes are meaningful (3 = fix
  the token, 4 = API rejected the request).
- Add `--verbose` to log requests to stderr when a call behaves unexpectedly.
