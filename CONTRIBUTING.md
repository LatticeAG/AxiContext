# Contributing

Thanks for working on AxiContext.

## Requirements

- Node.js 22 or newer
- pnpm through Corepack

```bash
corepack enable
pnpm install
```

## Common commands

```bash
pnpm build
pnpm test
pnpm typecheck
```

Run the CLI locally after build:

```bash
pnpm --filter @latticeag/axicontext start -- --help
```

Fixture repo:

```text
testdata/fixtures/minimal-node-repo
```

## Package boundaries

Follow the dependency directions in [SPEC-BUILD.md](./SPEC-BUILD.md).

- `packages/core` owns config, sync, graph, drift, query, and generated context behavior.
- `packages/server` owns the local Agent Read API.
- `packages/cli` owns CLI parsing and user-facing command behavior.
- `packages/sdk` owns TypeScript client access.
- `packages/adapters-git` owns local git and filesystem ingestion.
- `packages/parsers`, `packages/fence-core`, and `packages/fence` are the target package paths for shared parsing and AxiFence work.

Do not add cloud assumptions to OSS core code.

## Pull requests

- Keep changes scoped to the package or doc area you are touching.
- Add or update tests when behavior changes.
- Update docs when CLI flags, config fields, output files, or API routes change.
- Run build, tests, and typecheck before asking for review.

## Generated context

If a change affects generated `PROJECT_CONTEXT.md` output or drift behavior, test against `testdata/fixtures/minimal-node-repo`.
