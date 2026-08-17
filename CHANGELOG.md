# Changelog

## Unreleased

- Added root e2e coverage for `axictx init`, `sync`, `drift`, and `query` on the minimal Node fixture.
- Added a golden `PROJECT_CONTEXT.md` heading test backed by `testdata/expected/minimal-node-headings.txt`.
- Added AxiFence compose coverage that verifies the generated overlay includes PostgreSQL for the compose fixture.
- Updated README and Fence docs to cover both CLIs and their current flags.
- Tightened CI pnpm cache configuration.

## 0.1.0

Initial OSS release line for AxiContext.

- Added the `axictx` CLI with `init`, `doctor`, `sync`, `drift`, `query`, `serve`, and `status` commands.
- Added local config and manifest files under `.axicontext/`.
- Added generated `PROJECT_CONTEXT.md`.
- Added SQLite graph storage for structured context.
- Added local Agent Read API.
- Added TypeScript SDK package.
- Added CI and npm publish workflow metadata.

AxiFence is specified in this repository and lands in the later Fence phase.
