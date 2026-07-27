# CLAUDE.md

Guidance for working in the `@takt/pylon-cli` repository. This is a **public**,
MIT-licensed, agent-friendly CLI for the [Pylon API](https://docs.usepylon.com/pylon-docs/developer/api/api-reference).

## What this package is

A command line interface that covers all 136 Pylon API operations across 23
modules. The command tree, flags, and types are **generated** from the vendored
`openapi.json` — not hand-written — so the CLI stays in sync as the API evolves.
Output is JSON on stdout, JSON errors on stderr, and exit codes are
deterministic (see `src/runtime/errors.ts`).

## Toolchain

- **Node.js >= 20**, **pnpm** (pinned via `packageManager`). Never use `npm` or
  `yarn` for dependency work — the lockfile and toolchain are pnpm.
- **TypeScript**, ESM only (`"type": "module"`).
- **tsup** for builds, **vitest** for tests, **ESLint** + **Prettier** for
  quality, **openapi-typescript** for type generation.

## Repository layout

```
openapi.json            # Vendored Pylon spec — the source of truth. Build-time only, NOT published.
scripts/generate.ts     # Generator: openapi.json -> src/generated/*
src/
  bin.ts                # CLI entrypoint (published as the `pylon` bin)
  index.ts              # Programmatic entrypoint
  cli.ts                # Builds the commander tree from operation specs
  commands/             # Hand-written commands: auth, config, init
  generated/            # GENERATED — do not edit by hand
    operations.ts       #   OperationSpec[] + module metadata
    types.ts            #   openapi-typescript output
  runtime/              # Hand-written runtime: client, config, credentials,
                        #   flags, pagination, output, errors, multipart, io
test/                   # vitest — runtime unit tests + integration/cli.test.ts
```

### Generated code

`src/generated/*` is emitted by `pnpm generate` and **committed** (so the
package is inspectable and installs without a generation step). Never edit it by
hand. To pick up a new API version: replace `openapi.json`, run `pnpm generate`,
then review the diff to `operations.ts`/`types.ts`. Re-running on an unchanged
spec produces no diff.

The metadata shapes the generator emits (`OperationSpec`, `FlagSpec`) live in
`src/runtime/spec.ts` — keep the generator and that file in step.

## Everyday commands

```bash
pnpm install
pnpm dev -- <args>   # run the CLI from source via tsx (e.g. pnpm dev -- issues list)
pnpm generate        # regenerate src/generated/* from openapi.json
pnpm lint            # eslint . (pnpm lint:fix to autofix)
pnpm format          # prettier --write . (pnpm format:check in CI)
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest run (pnpm test:watch while developing)
pnpm build           # tsup -> dist/
```

## Conventions

- **Match the surrounding code.** The runtime is small and consistent — mirror
  its naming, error handling, and JSON-in/JSON-out contract.
- **Keep output machine-readable.** Success → JSON on stdout. Failure → a JSON
  error object on stderr plus a deterministic non-zero exit code. Don't print
  human prose to stdout; agents parse it.
- **New behavior needs a test.** Add or extend a vitest under `test/`. Runtime
  logic gets a unit test; end-to-end command behavior goes in
  `test/integration/cli.test.ts`.
- **Don't hand-edit `src/generated/` or `dist/`.** They're outputs.
- **Never commit secrets.** Real Pylon tokens look like `pyl_…`; only ever use
  placeholders (`pyl_xxxx`) in code, tests, and docs.

## Git & PRs

Trunk-based: branch off `main`, PR back into `main`. Follow the Takt commit
convention `type: description (LINEAR-ID)` and the git-workflow / github-pull-request
skills. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before pushing.

## What ships to npm

Only what's in the `files` allowlist: `dist/`, `README.md`, `LICENSE`. Source
maps are disabled (`sourcemap: false` in `tsup.config.ts`) and `openapi.json` is
build-time only — neither is published. Verify with `npm pack --dry-run` before
releasing. The scope is public via `publishConfig.access: "public"`.

## Release flow

Follow these steps in order to cut a release. **Confirm the version bump type
with the user before bumping.**

1. **Verify the tree is clean and on `main`.**
   ```bash
   git switch main && git pull
   git status   # must be clean
   ```

2. **Run quality gates.** Stop if anything fails.
   ```bash
   pnpm lint
   pnpm test
   ```

3. **Bump the version.** Ask the user whether this is a **major**, **minor**, or
   **patch** release (semver), then:
   ```bash
   pnpm version <major|minor|patch> --no-git-tag-version
   ```
   This updates `version` in `package.json` without creating a git tag (we tag
   via the GitHub release in step 7). Capture the new version:
   ```bash
   VERSION=$(node -p "require('./package.json').version")
   ```

4. **Install and build.**
   ```bash
   pnpm install   # sync lockfile to the new version
   pnpm build
   ```
   Sanity check the tarball: `npm pack --dry-run` — expect `dist/`, `README.md`,
   `LICENSE` only, no source maps, no `openapi.json`.

5. **Commit and push the version bump.**
   ```bash
   git add package.json pnpm-lock.yaml
   git commit -m "chore: release v$VERSION"
   git push origin main
   ```

6. **Publish to npm.** Requires `npm login` with publish rights on the `@takt`
   scope. `prepublishOnly` re-runs generate → lint → typecheck → test → build as
   a safety net.
   ```bash
   npm publish
   ```

7. **Create the GitHub release** named `v<version>` with auto-generated notes.
   This also creates the `v<version>` tag.
   ```bash
   gh release create "v$VERSION" --title "v$VERSION" --generate-notes
   ```

8. **Verify.** Confirm the version on npm and the release on GitHub:
   ```bash
   npm view @takt/pylon-cli version
   gh release view "v$VERSION"
   ```

### Notes

- `npm publish` is outward-facing and irreversible (a published version can't be
  re-published). Confirm the version and `npm pack --dry-run` output before
  running it.
- If publish fails after the version bump was pushed, don't reuse the version —
  bump again and retry.
