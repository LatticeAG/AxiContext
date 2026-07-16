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

## Target CLI

Per the spec:

```bash
axi-fence check .
axi-fence run . --dry-run
axi-fence run . --out .devcontainer
axi-fence badge . --json
```

Fence v0.1 is deterministic and rule-based. It does not call an LLM and it must not copy real secret values into generated files.

## Status

The Fence package layout is part of the locked monorepo design in [SPEC-BUILD.md](../SPEC-BUILD.md). AxiFence implementation lands after AxiContext P3.
