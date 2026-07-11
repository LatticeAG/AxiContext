# AxiContext OSS Foundation

This repository contains the open-source monorepo scaffold for AxiContext.

## Packages

- `@latticeag/axicontext-core` - shared types, config loading, and scaffolding logic
- `@latticeag/axicontext` - CLI (`axictx`) commands
- `@latticeag/axicontext-sdk` - SDK re-exports and client stubs

## Quickstart

```bash
pnpm install
pnpm build
pnpm --filter @latticeag/axicontext start -- init
pnpm --filter @latticeag/axicontext start -- doctor
```
