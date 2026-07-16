# SPEC-AxiFence — Implementation specification (v0.1.0)

**Status:** LOCKED — ready to implement (after AxiContext Phase P0 parsers exist)  
**Type:** Companion OSS product in the AxiContext monorepo  
**Package:** `@latticeag/axi-fence` (bin: `axi-fence`)  
**Core lib:** `@latticeag/axi-fence-core`  
**Shared dependency:** `@latticeag/axicontext-parsers`  
**License:** MIT  
**Build authority:** Follow `SPEC-BUILD.md` Phase P4. This file is the detailed Fence contract.

---

## 1. Problem

Contributing to an unfamiliar OSS repo often means hours of setup archaeology: package managers, runtimes, databases, env files, and undocumented README rituals. DevContainers are the standard answer, but writing them by hand does not scale.

## 2. Relationship to AxiContext

| | AxiContext | AxiFence |
|--|------------|----------|
| Job | Project memory for agents | One-click local env for humans |
| Input | Local git repo | Local path or GitHub URL |
| Engine | Context Graph + sync | Repo analysis + inference |
| Shared | `@latticeag/axicontext-parsers` | same |
| Output | `PROJECT_CONTEXT.md` + SQLite + Agent API | `.devcontainer/` + bootstrap + setup guide |

Fence must **not** import AxiContext graph internals. It consumes `RepoAnalysis` from parsers only.

## 3. Non-goals (v0.1)

- LLM / NLP README parsing (deferred)
- Private-repo cloud auth UX beyond env token passthrough
- Guaranteeing "80% of top 1000 starred repos" (aspirational research, not a release gate)
- Replacing Docker / DevContainer tooling itself
- Auto-running generated bootstrap without user review
- Writing real secrets into any file

## 4. Packages

```text
packages/parsers/      @latticeag/axicontext-parsers
packages/fence-core/   @latticeag/axi-fence-core
packages/fence/        @latticeag/axi-fence   # bin: axi-fence
```

Dependency direction:

```text
parsers → fence-core → fence
```

`fence-core` must not depend on `axicontext-core`.

## 5. CLI contract

### 5.1 Binary

- Name: `axi-fence`
- npm: `@latticeag/axi-fence`
- Node: `>=22`
- `NO_COLOR=1` respected
- `--json` on all commands that emit structured results

### 5.2 Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success / check passed |
| 1 | Check failed or runtime error |
| 3 | Invalid / invalid input |
| 4 | Clone / network failure (URL mode) |

### 5.3 Commands

#### `axi-fence check [target]`

`target` = local path (default `.`) or `https://github.com/org/repo` URL.

Behavior:

1. Resolve target to a local directory (clone if URL)
2. `analyzeRepo`
3. Run inference → `SetupPlan` + `CheckReport`
4. Print human summary or JSON
5. Exit 0 if `CheckReport.status === "pass"`, else 1

Flags:

- `--json`
- `--ci` (compact; no spinners)
- `--no-docker` (treat missing Docker hints as warnings, not blockers, when project clearly needs no services)
- `--min-score <0-100>` default `70`

#### `axi-fence run [target]`

Same resolve/analyze/infer as check, then write artifacts.

Flags:

- `--out <dir>` default repo root (writes `.devcontainer/`, `scripts/`, `README-SETUP.md`)
- `--overwrite` required to replace existing generated files
- `--dry-run` print planned file list + contents to stdout (or JSON), write nothing
- `--no-docker` omit compose overlay; use DevContainer features only when possible
- `--allow-readme-commands` allow embedding README-derived shell lines into bootstrap (off by default)
- `--json`

Generated files (default):

```text
.devcontainer/devcontainer.json
.devcontainer/docker-compose.yml   # only if services inferred and --no-docker not set
scripts/bootstrap.sh
README-SETUP.md
```

All generated files start with a banner comment naming `axi-fence` and plan digest.

#### `axi-fence badge [target]`

Prints shields.io markdown by default:

```markdown
[![AxiFence](https://img.shields.io/badge/AxiFence-pass-brightgreen)](https://github.com/LatticeAG/AxiContext)
```

`--json` returns `{ status, score, label, color, markdown }`.

## 6. Data schemas

### 6.1 SetupPlan

```typescript
interface SetupPlan {
  schema_version: "1.0.0";
  project_name: string;
  ecosystems: string[];
  package_manager: string;
  runtime: {
    kind: "node" | "python" | "rust" | "go" | "mixed";
    image: string;
    version_label: string;
  };
  services: Array<{
    name: string;
    image: string;
    port: number;
    env: Record<string, string>;
  }>;
  install_commands: string[];
  post_create_commands: string[];
  forward_ports: number[];
  env_keys: string[];
  remote_user: "vscode";
  digest: string;
  warnings: string[];
}
```

### 6.2 CheckReport

```typescript
interface CheckReport {
  schema_version: "1.0.0";
  status: "pass" | "fail";
  score: number;
  blockers: CheckItem[];
  warnings: CheckItem[];
  info: CheckItem[];
  plan_digest: string;
  generated_at: string;
}

interface CheckItem {
  code: string;
  message: string;
  path?: string;
}
```

### 6.3 Scoring (locked)

Start at 100. Apply deductions; floor at 0.

| Condition | Delta | Severity |
|-----------|-------|----------|
| No manifest detected | -50 | blocker |
| Manifest unparsable | -40 | blocker |
| Lockfile missing (node/python when expected) | -15 | warning |
| Runtime version unknown (using default) | -5 | info |
| Services needed but no compose and unknown how to provide | -20 | warning |
| `.env.example` missing but code references `process.env` heavily | -5 | info |
| Multiple ecosystems without workspace tooling | -10 | warning |

`status = pass` iff no blockers and `score >= min-score`.

## 7. Inference rules (deterministic)

### 7.1 Package manager

| Signal | Choice |
|--------|--------|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lock` / `bun.lockb` | bun |
| `package-lock.json` | npm |
| else `package.json` | npm |
| `poetry.lock` | poetry |
| `uv.lock` | uv |
| else `pyproject.toml` / `requirements.txt` | pip |
| `Cargo.toml` | cargo |
| `go.mod` | go |

### 7.2 Runtime images (defaults)

| Ecosystem | Default image |
|-----------|---------------|
| node | `mcr.microsoft.com/devcontainers/javascript-node:22` (override from `engines.node` major or `.nvmrc`) |
| python | `mcr.microsoft.com/devcontainers/python:3.12` (override from `requires-python`) |
| rust | `mcr.microsoft.com/devcontainers/rust:1` |
| go | `mcr.microsoft.com/devcontainers/go:1.22` |
| mixed | node image + notes in README-SETUP; primary = dominant ecosystem by manifest count |

### 7.3 Install commands

| Manager | Commands |
|---------|----------|
| pnpm | `pnpm install` |
| npm | `npm ci` if lockfile else `npm install` |
| yarn | `yarn install --frozen-lockfile` if yarn.lock else `yarn install` |
| bun | `bun install` |
| pip | `python -m pip install -r requirements.txt` or `pip install -e .` |
| poetry | `poetry install` |
| uv | `uv sync` |
| cargo | `cargo fetch` |
| go | `go mod download` |

### 7.4 Post-create / migration heuristics

Only include a command if an exact script/target name matches:

- package.json scripts: `db:migrate`, `migrate`, `prisma migrate deploy`
- Makefile targets: `migrate`, `db-migrate`, `setup`
- Never invent migrate commands if script absent

### 7.5 Services

From `docker-compose*.yml` first (authoritative).

Else from direct dependencies map:

| Dependency name match | Service |
|-----------------------|---------|
| `pg`, `postgres`, `postgresql`, `psycopg` | postgres:16, port 5432 |
| `redis`, `ioredis` | redis:7, port 6379 |
| `mysql`, `mysql2` | mysql:8, port 3306 |
| `mongodb`, `mongoose` | mongo:7, port 27017 |

Env defaults are disposable local values (`POSTGRES_PASSWORD=postgres`), never read from user `.env`.

### 7.6 Ports

Union of:

- Compose service ports
- Dockerfile `EXPOSE`
- Common framework defaults only if dependency present: next→3000, vite→5173, express/hono/fastify→3000 if mentioned in scripts

### 7.7 README commands

Without `--allow-readme-commands`:

- Surface as `CheckItem` info suggestions only
- Do not embed in `bootstrap.sh`

With flag: allow lines matching `^(npm|pnpm|yarn|bun|pip|poetry|uv|cargo|go) ` from fenced code blocks in README. Still reject lines containing `curl .* \| .*sh`, `sudo`, or `rm -rf /`.

## 8. Generators

### 8.1 `devcontainer.json`

Minimum shape:

```json
{
  "name": "<project_name>",
  "image": "<runtime.image>",
  "features": {},
  "forwardPorts": [],
  "postCreateCommand": "bash scripts/bootstrap.sh",
  "remoteUser": "vscode",
  "customizations": {
    "vscode": {
      "extensions": []
    }
  }
}
```

If compose overlay exists, use `dockerComposeFile` + `service: app` pattern instead of `image`, and generate an `app` service that uses the chosen base image and mounts the workspace.

Use a fixed template key order; document it in generator tests.

### 8.2 `scripts/bootstrap.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
# axi-fence:generated digest=sha256:...

# create .env from example keys if missing (empty values)
# run install_commands
# run post_create_commands
```

Must set the executable bit when written.

### 8.3 `README-SETUP.md`

One page:

1. Prerequisites (Docker Desktop / Dev Containers extension)
2. Reopen in Container
3. What bootstrap runs
4. Ports
5. Env keys to fill
6. Provenance: plan digest + axi-fence version

## 9. URL / clone behavior

1. Parse GitHub HTTPS or SSH URL → owner/repo
2. `git clone --depth 1` into `os.tmpdir()/axi-fence-<hash>`
3. Analyze
4. **Locked:** URL mode requires `--out <dir>` for `run`; `check`/`badge` use temp and delete after
5. Cleanup temp on process exit

Network failures → exit 4.

## 10. Security

| Threat | Mitigation |
|--------|------------|
| Secret leakage via `.env` | Never read `.env`; only key names from `*.example` / `*.sample` |
| Malicious repo scripts | `check` does not execute project scripts; `run` only writes files |
| Pipe-to-shell in README | Rejected even with `--allow-readme-commands` |
| Path traversal in `--out` | Resolve and ensure writes stay under intended out dir |
| Private code exfiltration | No network except optional git clone; no telemetry |

## 11. Testing

### 11.1 Fixtures

| Fixture | Expect |
|---------|--------|
| `minimal-node-repo` | pass; npm/pnpm install; node image |
| `minimal-python-repo` | pass; pip/poetry/uv per files |
| `minimal-rust-repo` | pass; cargo |
| `minimal-go-repo` | pass; go mod download |
| `compose-node-repo` | postgres service in compose overlay |
| Fixture with planted `.env` secret | secret value never appears in any generated file |

### 11.2 Golden

- `devcontainer.json` for `minimal-node-repo` matches expected key set
- `bootstrap.sh` contains install command for detected manager
- `check --json` score stable for fixture

### 11.3 CI

After AxiContext E2E:

```bash
axi-fence check testdata/fixtures/minimal-node-repo
axi-fence run testdata/fixtures/minimal-node-repo --dry-run --json
```

## 12. Docs

- `docs/fence.md` — quickstart, flags, security notes
- README section linking Fence as companion CLI
- CHANGELOG entry for 0.1.0

## 13. Versioning

- Independent package names; lockstep version `0.1.0` with AxiContext monorepo release preferred
- `SetupPlan.schema_version` independent from CLI semver
- Fence depends on `axicontext-parsers` via semver `^0.1.0`

## 14. Acceptance checklist

- [ ] `axi-fence check .` works on Node/Python/Rust/Go fixtures
- [ ] `axi-fence run . --dry-run` prints planned artifacts without writes
- [ ] `axi-fence run .` creates reviewable DevContainer files
- [ ] Compose fixture gets DB service
- [ ] No `.env` values in outputs
- [ ] No LLM dependency in package.json
- [ ] Published to npm as `@latticeag/axi-fence`

## 15. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0-proposal | 2026-07-11 | Product sketch |
| 1.0.0-impl | 2026-07-16 | Implementation-grade lock for OSS v0.1 build |
