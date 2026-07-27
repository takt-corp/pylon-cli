# How Pylon Works — Conceptual Model

The mental model behind the API, so you pick the right command instead of
guessing. Pylon is an agentic B2B customer-support / customer-ops platform: a
shared inbox + lightweight CRM unifying Slack, email, chat, and portal channels,
with an AI agent, knowledge base, and account management on top.

Two hubs anchor everything: the **Issue** is the hub of the support side, the
**Account** is the hub of the CRM side, and the **Contact** joins a person to
their company. Source of truth for exact field shapes is the CLI's `openapi.json`
(grep it); this file is the *why/when*. Verified against that spec where noted.

## Table of contents

- [Object catalog & when to reach for each](#object-catalog--when-to-reach-for-each)
- [The object graph](#the-object-graph)
- [Issue lifecycle & state model](#issue-lifecycle--state-model)
- [Channels & the message model](#channels--the-message-model)
- [Accounts & contacts](#accounts--contacts)
- [Custom fields vs custom objects](#custom-fields-vs-custom-objects)
- [Search & filtering](#search--filtering)
- [AI features](#ai-features)
- [Constraints, gotchas & terminology](#constraints-gotchas--terminology)

## Object catalog & when to reach for each

| Object | What it is | Reach for its API when… |
| --- | --- | --- |
| **Issue** | A support ticket/conversation — the central unit of work. | The user talks about a ticket, request, escalation, "what's open", replying to a customer. |
| **Account** | The customer *company* (CRM company record). `type`: `customer`\|`partner`. | You need customer context (owner, tags, custom fields, health) or to find/update a company. |
| **Contact** | An individual *person* at an account; the requester on issues. | You need the human who wrote in, or to create/import end users. |
| **User** | A Pylon *team member* / seat (the AI Support Agent is also a User). | You need assignees, reply authors, followers, or to look up a teammate. |
| **Team** | A group of Users (Tier 1, Billing…). | Routing an issue, or team-scoped SLAs. |
| **Task** | A work item belonging to an account (optionally a project/milestone), with comments. | Tracking follow-ups / action items on a customer. |
| **Project / Milestone** | A per-account container of tasks + dated waypoints. | Onboarding, migrations, implementations — larger multi-step customer initiatives. |
| **Message** | One communication inside an issue (reply, note, or AI response). | Reading or posting to a conversation. |
| **Thread** | A container of *internal* notes on an issue (not customer-visible). | Side discussion among the team; may sync to a chat channel. |
| **Tag** | Free-form label on issues/accounts. | Categorization, filtering, macro/trigger conditions. |
| **Macro** | Saved reusable action bundle (canned reply + field changes). | Applying a standard response/workflow in one shot. |
| **Custom Field** | Customer-defined *attribute* on a standard object. | Reading/writing extra columns on issues, accounts, contacts, etc. |
| **Custom Object** | Customer-defined *entity type* (a whole new record kind). | Domain records like licenses, devices, subscriptions. |
| **Knowledge Base / Collection / Article** | Help-content hierarchy: KB → collections → articles. | Managing docs; articles are a primary AI training source. |
| **Feature Request** | Aggregated product-demand record. | Rolling up customer asks for product prioritization. |
| **Survey** | CSAT/NPS/custom feedback instrument → responses. | Reading customer feedback / CSAT. |
| **Call Recording** | Imported call/meeting (Gong, Fathom…) attached to an account. | Pulling conversation-intelligence context on a customer. |
| **Activity** | An event on an account's timeline. | Logging or reading customer touchpoints. |
| **Audit Log** | Immutable record of actions. | Compliance / security / change history. |
| **Ticket Form** | Configured intake-form definition (`ticket_form_id` on issues). | Understanding structured intake. |
| **Training Data** | External docs/URLs indexed for the AI. | Expanding what Ask AI / Copilot / Support Agent can draw on. |
| **User Role** | A permission set applied to Users. | Access-control questions. |

## The object graph

```
Account (customer company)
 ├─ external_ids[]  ← YOUR ids, used to match/upsert
 ├─ domains[] / primary_domain,  owner ─► User,  tags[] / custom_fields{}
 ├─ Contacts     (1 account → many people)
 ├─ Issues       (1 account → many tickets)
 ├─ Projects → Milestones,  Tasks (also can be account-level standalone)
 ├─ Activities, Call Recordings, Highlights
 └─ Account Relationships (partner ↔ customer, parent ↔ subaccount)

Issue (ticket)
 ├─ account ─► Account,  requester ─► Contact,  assignee ─► User,  team ─► Team
 ├─ followers[] ─► User|Contact,   ticket_form ─► Ticket Form
 ├─ tags[] / custom_fields{}
 ├─ Messages[] (the conversation) → Threads (internal-note containers)
 ├─ external_issues[] (Jira / GitHub / Linear links),  csat_responses[]
 └─ team_slas[] + SLA timing fields
```

**MiniX pattern (important):** an Issue embeds only *lightweight* references —
MiniAccount / MiniContact / MiniUser / MiniTeam (IDs + a couple fields). For real
context, fetch the full object: `accounts get-account`, `contacts get-contact`,
`users get-user`. Custom-field *values* live inline on each record as a
`custom_fields` map keyed by **slug**; the field *definition* lives in the
`custom-fields` module.

## Issue lifecycle & state model

Five built-in status categories (the API field is `state`, a **string**, which
the UI calls *status* — same thing):

| `state` category | Meaning | Who's up next |
| --- | --- | --- |
| `new` | No team response yet | Team |
| `waiting_on_you` ("On You") | Team action needed | Team |
| `waiting_on_customer` ("On Customer") | Awaiting customer | Customer |
| `on_hold` | Blocked externally; snoozed issues land here | Nobody active |
| `closed` | Resolved | — |

- **`state` is org-configurable, not a fixed enum** (verified: the spec types it
  as a free string). Orgs can add custom statuses, but only *within* the
  `on_hold` and `closed` categories. **Always run `pylon issues get-issue-statuses`
  to discover the valid values** before filtering or setting — don't hardcode
  `open`/`closed` literals.
- **Auto-transitions:** Pylon re-statuses issues automatically based on who last
  replied, even when a teammate answers directly in Slack/email.
- **Snoozing:** `issues snooze-issue` with a snooze time (RFC3339) → issue moves
  to On Hold, carries `snoozed_until_time`, resurfaces when it expires.
- **Assignment:** `assignee_id` (User) and/or `team_id` (Team) via `update-issue`.
  Setting either to an **empty string removes it** (unassign) — it is not "leave
  unchanged." Confirm intent.
- **Followers:** Users or Contacts who get updates without owning the issue —
  `add-issue-followers` / `get-issue-followers`.
- **Type:** `conversation` vs `ticket` (verified enum). Conversations are
  lightweight and can be upgraded to tickets; filter on this via `issue_type`.
- **SLAs:** First-Response, Next-Response, Resolution — with breach times and
  business-hours ("Support Hours") variants; Team SLAs measure a team's own
  clock. Read them off the full issue (`get-issue`).

**Agent moves:** "open tickets" → `search-issues` with a `state` filter (NOT
`get-issues`). "Snooze until Monday" → `snooze-issue`. "Assign to X / route to
Billing" → `update-issue`. "Who owns this / SLA status" → `get-issue` (single
fetch is richest).

## Channels & the message model

**Sources an issue can arrive from** (verified enum): `slack`,
`microsoft_teams`, `microsoft_teams_chat`, `chat_widget`, `email`, `manual`,
`form`, `discord`, `whatsapp`, `sms`, `telegram`, `phone`. Every channel funnels
into one unified Issue.

**Message vs Thread:** a **Message** is one communication (`is_private` true =
internal note, false = customer-visible; `author` is a Contact or a User;
`message_html`, `timestamp`, `source`; email carries `email_info`). A **Thread**
is a container of *internal* notes (never customer-visible), optionally synced to
a chat channel. An issue can have multiple threads.

**Four things you can post to an issue:**

| Intent | Command | Customer sees it? |
| --- | --- | --- |
| Reply to the customer | `issues create-issue-reply` (needs `message_id` + body) | **Yes** |
| Internal note to the team | `issues create-issue-note` | No |
| New internal thread | `issues create-issue-thread` | No |
| AI-drafted response | `issues create-issue-ai-response` | Yes |

Read history first with `messages get-issue-messages` (paginated). Destructive:
`messages delete-message` (also removes from the connected external system) and
`messages redact-message` (permanently scrubs content, keeps the record — for
stripping sensitive data). Replying and noting are customer-visible or
irreversible — confirm intent before running.

## Accounts & contacts

Three-way distinction: **User** = your side (staff/AI seat) · **Account** = the
customer *company* · **Contact** = a *person* at that company (the requester).

- **External IDs:** attach *your own* identifiers to accounts/contacts so you can
  reference them by your key (crucial for matching chat-widget issues to the
  right account). Each is `{external_id, label}`.
- **Relationships & hierarchy:** `create/get/delete-account-relationship` model
  links; partner accounts (`type: partner`) and parent/child subaccounts layer on
  top.
- **Highlights:** pinned key facts shown in the account sidebar
  (`create/update/delete-account-highlight`) — use for "the important context on
  this customer."
- **Merging:** `merge-accounts` folds accounts into a survivor that inherits
  issues, contacts, domains, channels, and external IDs — **but NOT tags or
  custom-field values.** Merged accounts are permanently deleted. Destructive:
  read both accounts and confirm first.
- **Contacts:** `create-contact` = one new record; `import-contact` = bulk/upsert
  backfill by external identity.

**Agent moves:** issue in hand, need customer context → `accounts get-account`.
Find a company → `search-accounts`. Find the person → `contacts get-contact` /
`search-contacts`. Bulk CRM update → `accounts update-accounts`.

## Custom fields vs custom objects

- **Custom Field** = an extra *attribute* on an existing object (issues,
  accounts, contacts, custom objects, call recordings, feature requests). Types
  include text, select, multiselect, and **relationship** (points at another
  object by ID). Set single-valued via `value`, multiselect via `values[]` (use
  option *slugs*). Discover valid slugs/options with `custom-fields
  get-custom-fields`; write values with `--custom-fields-json` on
  `update-issue`/`update-account`.
- **Custom Object** = a whole *new record kind* the customer defines (Licenses,
  Devices, Contracts…), each with its own custom fields and `relations[]`, linked
  to accounts (built-in) and to contacts/issues via relationship fields. Query
  with `custom-objects search-custom-objects`.

Rule of thumb: extra column on an existing record → custom **field**; a new kind
of record → custom **object**.

## Search & filtering

The single most common trap — two very different issue-list paths:

| Path | Command | Scoping | Constraint |
| --- | --- | --- | --- |
| Time-window list | `issues get-issues` | `start-time`/`end-time` **only — no state filter** | RFC3339, **≤30-day window**; `limit` up to 20000 |
| Filtered search | `issues search-issues` | full filter grammar + `--search-text` | `limit` up to 1000 (default 100) |

Default to **`search-issues`** for anything scoped by status/account/assignee.
Use `get-issues` only for "everything in this date range" — chunk spans >30 days
and add `--all`.

A filter node = `field` + `operator` + `value`/`values`; `and`/`or` nodes take
`subfilters[]` (verified shape). `field` is a free string, so **custom-field
slugs are valid filter fields**. Operators (verified enum): `equals`,
`not_equals`, `contains`, `does_not_contain`, `in`, `not_in`, `and`, `or`,
`time_is_after`, `time_is_before`, `time_range`, `string_contains`,
`string_does_not_contain`, `is_set`, `is_unset`, `greater_than`, `less_than`,
`greater_than_or_equals`, `less_than_or_equals`.

Commonly filterable issue fields (per Pylon docs): `state`, `account_id`,
`requester_id`, `assignee_id`, `team_id`, `issue_type`, `ticket_form_id`,
`tags`, `title`/`body_html` (string ops), and time fields (`created_at`,
`updated_at`, `resolved_at`, `latest_message_activity_at`). Compound example —
open issues for one account:

```json
{ "filter": { "operator": "and", "subfilters": [
  { "field": "state",      "operator": "equals", "value": "open" },
  { "field": "account_id", "operator": "equals", "value": "acc_123" }
] } }
```

Search exists across modules: `search-accounts`, `search-contacts`,
`search-tasks`, `search-projects`, `search-custom-objects`,
`search-feature-requests`, `search-surveys`, `search-call-recordings`,
`search-audit-logs`, `search-users`.

## AI features

- **Support Agent** — an AI *User* you assign to an issue; answers from KB/docs,
  gathers info, can resolve end-to-end. Its output is a customer-visible AI
  response (`issues create-issue-ai-response`).
- **Copilot / Ask AI** — assists human agents in the flow (drafting,
  summarizing), rather than acting autonomously.
- **Training Data** (`training-data` module) is what the AI draws on. Default and
  always-on: your past Pylon issues + your Knowledge Base. Added sources: public
  URLs (crawled), Google Docs, GitHub repos, uploaded files/content. To improve
  future AI answers, add sources here.
- **Knowledge Base's role:** articles are a first-class training source; an
  article's `visibility_config` controls both access *and* whether the AI may use
  it.

## Constraints, gotchas & terminology

- **Auth:** bearer token only (`Authorization: Bearer pyl_…`), created under
  **Settings → API**. No granular scopes documented; token actions appear under
  the token's name in audit logs. Validate with `pylon me`.
- **Rate limits (approximate, from Pylon docs — verify with `--verbose`):** reads
  ~60/min, writes ~20/min, heavy list/bulk/merge ~10/min. Issue *list* is ~10/min.
- **Pagination:** cursor-based; `--cursor`/`--limit`, `--all` to auto-follow.
  Always check `truncated` on an `--all` result — `true` = incomplete.
- **IDs & timestamps:** prefixed IDs (`acc_`, `contact_`, `user_`, issue-prefixed
  + a human-facing sequential `number`); statuses & custom fields are **slugs**
  (lowercase_underscore); external IDs are your own strings. All timestamps are
  **RFC3339** (`2026-01-31T00:00:00Z`).
- **Irreversible / propagating actions:** merge-accounts (drops tags + custom
  fields), delete-message, redact-message, delete-* — several also propagate to
  connected systems (Slack, Jira). Read the object first and confirm.
- **Terminology map:** "ticket" = Issue · "customer" = Account · "the person who
  wrote in" = Contact/requester · "agent/rep/teammate" = User · "canned response"
  = Macro · "status" = the `state` field · "internal comment" = note/thread ·
  "docs/help center" = Knowledge Base articles.
