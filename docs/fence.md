# AxiFence

AxiFence is the companion OSS CLI specified in [SPEC-AxiFence.md](../SPEC-AxiFence.md).

Its job is different from AxiContext:

| Tool | Job | Output |
|------|-----|--------|
| AxiContext | Project memory for agents | `PROJECT_CONTEXT.md`, SQLite graph, Agent Read API |
| AxiFence | Local setup inference for humans | DevContainer files, bootstrap script, setup report |

The target packages are:

```text
packages/parsers/      @latticeag/axicontext-parsers
packages/fence-core/   @latticeag/axi-fence-core
packages/fence/        @latticeag/axi-fence
```

The dependency direction is:

```text
parsers -> fence-core -> fence
```

Fence must not import AxiContext graph internals. It consumes shared repo analysis from `@latticeag/axicontext-parsers`.

## CLI

Use a local path or a public GitHub URL as the target. Local path defaults to the current directory.

```bash
axi-fence check .
axi-fence run . --dry-run
axi-fence run . --out . --overwrite
axi-fence badge . --json
```

Fence v0.1 is deterministic and rule-based. It does not call an LLM and it must not copy real secret values into generated files.

### `axi-fence check [target]`

Analyzes setup signals, infers a setup plan, and prints pass/fail status.

Flags:

- `--json` prints the plan and report as JSON.
- `--ci` prints one compact summary line.
- `--no-docker` treats missing Docker hints as non-blocking.
- `--min-score <0-100>` changes the passing score. The default is `70`.

### `axi-fence run [target]`

Generates reviewable setup files:

- `.devcontainer/devcontainer.json`
- `.devcontainer/docker-compose.yml` when services are inferred
- `scripts/bootstrap.sh`
- `README-SETUP.md`

Flags:

- `--dry-run` prints the planned files and writes nothing.
- `--json` prints the plan and file contents or written file list as JSON.
- `--out <dir>` chooses the output root. URL targets require this flag.
- `--overwrite` replaces existing generated files. Without it, existing files make the command exit with code `3`.
- `--no-docker` omits the compose overlay.
- `--allow-readme-commands` is reserved for safe README-derived commands when parsers provide them.

### `axi-fence badge [target]`

Prints a Shields markdown badge for setup readiness.

Flags:

- `--json` prints `{ status, score, label, color, markdown }`.

## Compose services

If a repo already has Compose services, Fence uses those hints before dependency-based service inference. For the `compose-node-repo` fixture, the generated overlay includes a `postgres` service and forwards port `5432`.

## Status

The Fence package layout is part of the locked monorepo design in [SPEC-BUILD.md](../SPEC-BUILD.md), with improvement work tracked in [SPEC-IMPROVE.md](../SPEC-IMPROVE.md).
