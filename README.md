# AxiContext

**Project context controller for AI coding agents** — local-first, MIT-licensed OSS.

AxiContext generates and maintains `PROJECT_CONTEXT.md`, a SQLite Context Graph under `.axicontext/`, and a local Agent Read API so agents query structured project memory with provenance instead of re-reading the entire repo.

> **Scope:** OSS Phase 1 only. See [SPEC.md](./SPEC.md) for the full implementation specification.

## Quickstart

```bash
pnpm install
pnpm build

# In any git repository:
pnpm --filter @latticeag/axicontext start -- init
pnpm --filter @latticeag/axicontext start -- sync
pnpm --filter @latticeag/axicontext start -- drift
pnpm --filter @latticeag/axicontext start -- serve
```

## Packages

| Package | Description |
|---------|-------------|
| `@latticeag/axicontext` | CLI (`axictx`) |
| `@latticeag/axicontext-core` | Graph, sync, drift, config |
| `@latticeag/axicontext-server` | Local Agent Read API (Hono) |
| `@latticeag/axicontext-sdk` | TypeScript SDK |
| `@latticeag/axicontext-adapter-git` | Git source adapter |

## Commands

```bash
axictx init          # scaffold .axicontext/
axictx doctor        # validate setup
axictx sync          # ingest sources → graph → PROJECT_CONTEXT.md
axictx drift         # compare live state vs manifest
axictx query "..."   # FTS search over context excerpts
axictx serve         # start http://127.0.0.1:8787 Agent Read API
axictx status        # manifest + graph summary
```

## Agent integration

Point Cursor or Claude Code at `PROJECT_CONTEXT.md`, or query the local API:

```http
GET http://127.0.0.1:8787/v1/context/slice?topic=authentication&max_tokens=2000
```

## Development

```bash
pnpm build
pnpm test
```

Fixture repo: `testdata/fixtures/minimal-node-repo/`

## License

MIT — see [LICENSE](./LICENSE).
