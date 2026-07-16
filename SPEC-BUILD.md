# SPEC-BUILD — Implementation-ready build contract

**Status:** LOCKED — ready to implement  
**Date:** 2026-07-16  
**Products:** AxiContext OSS v0.1.0 + AxiFence OSS v0.1.0  
**Repo:** `github.com/LatticeAG/AxiContext` (single monorepo)  
**Authority:** This document overrides conflicting older notes in `PLAN-OSS-PRODUCTION.md` open questions. `SPEC.md` remains the product bible for AxiContext behavior; where this file and `SPEC.md` conflict on delivery order or package layout, this file wins. Where they conflict on data model or CLI semantics, `SPEC.md` wins unless this file explicitly amends it.

---

## 0. Locked product decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | First npm when | After Workstream A (AxiContext M1) is green |
| 2 | GitHub Issues adapter | **M2** — do not block v0.1.0 |
| 3 | AxiFence location | **Same monorepo**, sibling packages |
| 4 | Fence LLM | **None in v0.1** — rule-based only |
| 5 | Shared parsers | Extract **during** AxiContext M1 (before Fence code) |
| 6 | Fence package | `@latticeag/axi-fence`, bin `axi-fence` |
| 7 | SDK in v0.1.0 | **Thin real API**: `fromRepo` in-process + `connect` HTTP client |
| 8 | SARIF drift | **v0.1.0** — include (`--format sarif`) |
| 9 | MCP server | **v0.2** — specify only |
| 10 | README tone | Professional, no decorative emoji in headings |
| 11 | Auto-edit `.gitignore` | **No** in v0.1 — print suggestions only |
| 12 | Incremental sync | **Not claimed** in v0.1; full resync is correct |
| 13 | Embeddings | **Off**; no download path in v0.1 |
| 14 | Telemetry | **None** |
| 15 | Node | `>=22` |

---

## 1. End-state acceptance (definition of done)

### 1.1 AxiContext v0.1.0

An external user can:

```bash
npm i -g @latticeag/axicontext
cd their-repo
axictx init
axictx sync
axictx drift --ci --fail-on-drift   # exit 0 on clean tree after sync+commit baseline
axictx query "how does auth work?" --json
axictx serve                         # 127.0.0.1:8787
```

And get:

- Committed `PROJECT_CONTEXT.md` with locked section order + banner hash
- `.axicontext/config.toml` + `manifest.json` committed
- `.axicontext/graph/graph.sqlite` created and gitignored (suggestion printed)
- Graph-backed FTS query with provenance
- Loopback-only serve by default; refuse `0.0.0.0` without `api_token`
- Denylist + redaction so secrets do not land in Markdown/excerpts
- Zero phone-home

### 1.2 AxiFence v0.1.0

```bash
npm i -g @latticeag/axi-fence
axi-fence check .
axi-fence run . --dry-run
axi-fence run . --out .devcontainer
axi-fence badge . --json
```

And get reviewable DevContainer artifacts from shared parsers, no LLM, no secret copying.

### 1.3 Monorepo health

```bash
pnpm install && pnpm build && pnpm test && pnpm typecheck
```

CI also runs fixture E2E for both CLIs.

---

## 2. Target monorepo layout

```text
/
├── SPEC.md
├── SPEC-BUILD.md              # this file (build authority)
├── SPEC-AxiFence.md           # Fence detail (implementation grade)
├── PLAN-OSS-PRODUCTION.md     # historical gap analysis (reference)
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── CHANGELOG.md
├── package.json
├── pnpm-workspace.yaml
├── docs/
│   ├── install.md
│   ├── config.md
│   ├── agent-integration.md
│   ├── ci.md
│   ├── fence.md
│   ├── schema.md
│   └── security.md
├── packages/
│   ├── parsers/               # @latticeag/axicontext-parsers
│   ├── core/                  # @latticeag/axicontext-core
│   ├── adapters-git/          # @latticeag/axicontext-adapter-git
│   ├── cli/                   # @latticeag/axicontext  (bin: axictx)
│   ├── server/                # @latticeag/axicontext-server
│   ├── sdk/                   # @latticeag/axicontext-sdk
│   ├── fence-core/            # @latticeag/axi-fence-core
│   └── fence/                 # @latticeag/axi-fence  (bin: axi-fence)
├── testdata/
│   ├── fixtures/
│   │   ├── minimal-node-repo/
│   │   ├── minimal-python-repo/
│   │   ├── minimal-rust-repo/
│   │   ├── minimal-go-repo/
│   │   ├── compose-node-repo/
│   │   └── drift-seed-repo/
│   └── expected/
├── tests/
└── .github/workflows/
    ├── ci.yml
    └── publish.yml
```

### 2.1 Dependency graph (locked)

```text
parsers
  ├─► adapters-git ─► (types from) core
  └─► fence-core ─► fence

core ◄── server ◄── cli
core ◄── sdk
core does NOT depend on adapters-git, fence, or parsers for graph ops
cli depends on: core, server, adapters-git (registry)
fence depends on: fence-core
fence-core depends on: parsers
adapters-git depends on: core (types), parsers
```

**Rule:** `packages/core` must not list `adapters-*` or `axi-fence*` as dependencies.

---

## 3. Build phases (strict order)

| Phase | Name | Ships |
|-------|------|-------|
| **P0** | Cleanup + parsers extract | Internal only |
| **P1** | SQLite sync + policy + PROJECT_CONTEXT | Core truth |
| **P2** | Drift + query + server + CLI polish | Agent path |
| **P3** | SDK + docs + CI E2E + npm publish axictx | **AxiContext v0.1.0** |
| **P4** | Fence core + CLI + docs + publish axi-fence | **AxiFence v0.1.0** |
| **P5** | M2 backlog | GitHub Issues, MCP, brew, etc. |

Do not start a later phase until the prior phase acceptance passes.

---

## 4. Phase P0 — Cleanup + parsers

### 4.1 Delete / stop shipping

Delete these files (or move content then delete):

- `packages/core/src/graph-store.ts` (after P1 migrates callers)
- `packages/core/src/axicontext-*.ts`
- `packages/core/src/axi-index.ts`
- `packages/cli/src/bin.ts`
- `packages/cli/src/index.ts`
- Root `package-lock.json` (pnpm-only repo)

Keep single entries:

- Graph: `packages/core/src/graphStore.ts`
- CLI: `packages/cli/src/axictx-cli.ts`
- Core barrel: `packages/core/src/index.ts`

Update `packages/core/tsconfig.json` to include `graphStore.ts`.

### 4.2 Package `@latticeag/axicontext-parsers`

**Path:** `packages/parsers`

**Public API (locked):**

```typescript
export interface RepoAnalysis {
  schema_version: "1.0.0";
  root: string;
  ecosystems: Array<"node" | "python" | "rust" | "go" | "java" | "unknown">;
  mixed: boolean;
  project_name: string;
  manifests: ManifestFact[];
  lockfiles: LockfileFact[];
  important_files: PathFact[];
  readmes: PathFact[];
  dockerfiles: PathFact[];
  compose_files: PathFact[];
  makefiles: PathFact[];
  justfiles: PathFact[];
  env_examples: PathFact[];
  workflows: PathFact[];
  tree: TreeFact;
  package_manager?: "pnpm" | "npm" | "yarn" | "bun" | "pip" | "poetry" | "uv" | "cargo" | "go";
  runtime_hints: RuntimeHints;
  services: ServiceHint[];
  scripts: ScriptHint[];
  warnings: string[];
  digest: string;
}

export function analyzeRepo(root: string, opts?: AnalyzeOptions): Promise<RepoAnalysis>;
```

`digest` = `sha256(stableStringify(analysis))` with absolute `root` replaced by `"."` so digests are portable.

**Must parse:**

| Source | Extract |
|--------|---------|
| `package.json` | name, deps/dev/peer/optional, scripts, engines, packageManager, workspaces |
| `pyproject.toml` | via `@iarna/toml`: project name, requires-python, dependencies, optional-deps, build-system |
| `Cargo.toml` | package name, edition, deps, workspace members |
| `go.mod` | module path, go version, require block |
| Dockerfile* | base image, `EXPOSE` ports (best-effort) |
| docker-compose*.yml | service names, images, ports |
| Makefile / Justfile | target names |
| `.env.example` / `.env.sample` | key names only (never values from real `.env`) |

**Ignores:** `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `.turbo`, `target`, `out`.

**Acceptance:**

- Unit tests for each manifest type
- `analyzeRepo(minimal-node-repo)` returns stable `digest` across two runs
- No dependency on `axicontext-core` graph types

### 4.3 Refactor git adapter onto parsers

`GitSourceAdapter.ingest`:

1. Call `analyzeRepo`
2. Map `RepoAnalysis` → SPEC graph nodes/edges/excerpts
3. Compute adapter digest from analysis digest + commit list snapshot

Node ID mapping (locked):

| Analysis | Node |
|----------|------|
| project | `project:{name}` type `project` |
| manifest package | `module:{posix-path}` type `module` |
| dependency | `dep:{eco}:{name}` type `dependency` |
| important/readme/workflow file | `file:{posix-path}` type `file` with `role` |
| tree | `tree:digest` type `tree_digest` |
| commit | `commit:{sha}` type `commit` |

Excerpts carry provenance: `{ adapter: "git", path, commit?, start_line?, end_line?, ingested_at }`.

**Acceptance:** adapter package depends on `core` + `parsers`; core does not depend on adapter.

---

## 5. Phase P1 — SQLite sync + policy + Markdown

### 5.1 GraphStore (canonical)

File: `packages/core/src/graphStore.ts`

- Depend on `better-sqlite3` in `packages/core/package.json`
- Document native compile requirement in `docs/install.md`
- WAL mode; DDL per SPEC.md §8.2
- Node/edge enums include: `commit`, `tree_digest`, `authored_by`
- `computeContentHash()` hashes **ids only** (sorted node ids, edge ids, excerpt ids). No timestamps.
- `exportManifest(adapterDigests)` matches SPEC §8.8 shape
- Excerpt default id = `sha256(text + stableStringify(provenance))`

### 5.2 Sync pipeline

`runSync(repoRoot, options)`:

1. Resolve repo root (`AXICTX_REPO_ROOT` or cwd)
2. Load `.axicontext/config.toml` (fail exit 3 if invalid; **no silent fallback** for sync/drift/serve)
3. `GraphStore.open(repoRoot)`
4. For each enabled adapter from **injected registry** (CLI passes adapters; core accepts `SourceAdapter[]`)
5. Upsert all nodes/edges/excerpts
6. `applyPolicy(graph, config.policy)` — denylist drop + redact excerpt text
7. Write manifest + PROJECT_CONTEXT.md
8. Close store
9. Return summary JSON shape (SPEC.md Appendix B)

CLI owns:

```typescript
const adapters = [new GitSourceAdapter()];
await runSync(repoRoot, { adapters, ...flags });
```

Flags for v0.1.0:

- `--repo-root`
- `--dry-run`
- `--adapters git`
- `--max-chars`, `--max-files`, `--max-lines-per-file`
- `--fail-on-drift`
- `--json`

Exit codes: 0 ok, 1 error, 2 drift (with flag), 3 config, 4 all enabled adapters failed.

### 5.3 Policy pack

New: `packages/core/src/policy.ts`

- Denylist globs from config (defaults per SPEC §6.1)
- Redaction patterns: `aws_access_key`, `pem_block`, `slack_token`, `github_token`, `jwt`
- Replace matches with `[REDACTED:pattern_id]`
- Attach `secret_risk: true` in node data when redaction fired (not printed in Markdown body)

Built-in `default` pack lives in code for v0.1. Init may write `.axicontext/policies/default.toml` as a pointer stub.

### 5.4 PROJECT_CONTEXT.md

- Exact headings in SPEC §9.2 order (all of them; empty sections get `_None detected._`)
- Banner: `<!-- axi:generated managed-by=axictx schema=1.0.0 hash=sha256:... -->`
- Preserve blocks between `<!-- axi:manual -->` and `<!-- /axi:manual -->`
- Truncate by `max_chars`: drop Glossary detail, then Provenance detail, then Open Issues extras

### 5.5 Config schema (locked for ship)

`DEFAULT_CONFIG_TOML` and Zod must include:

- `serve.api_token`
- `[query]` with `max_tokens_default`, `embeddings = "off"`
- `[policy]` denylist + `redact_patterns`
- `[drift] fail_on`, `ignore_paths`
- Full `[adapters.git]` knobs from SPEC §6.1
- `schema_version` must equal `"1.0.0"` or throw
- `project_context.max_chars` ≤ 500_000

`loadAxiConfig` **must** pass through `api_token` from file/env.

Env overrides: SPEC §6.3 + `AXICTX_API_TOKEN` overrides `serve.api_token`.

### 5.6 Init / doctor

Init:

- Create `.axicontext/`, config, stub PROJECT_CONTEXT with banner comment
- Print gitignore suggestions including `.axicontext/graph/`
- Detect `mixed` when ≥2 ecosystems present
- Flags: `--overwrite-config`, `--yes`, `--json`

Doctor checks:

1. Node ≥22
2. `.axicontext/` exists
3. config parses
4. If manifest exists → graph.sqlite readable
5. Warn if `serve.host` not loopback and no token

---

## 6. Phase P2 — Drift, query, server, CLI

### 6.1 Drift

Single source of truth for digests:

| Signal | How computed (sync writes; drift recomputes) |
|--------|-----------------------------------------------|
| `adapters.git.digest` | Same as adapter `result.digest` |
| content_hash | GraphStore content hash |
| readme sha | sha256 of normalized README text |
| direct deps set | sorted `eco:name@version` from dependency nodes |
| auth paths | sorted file node paths matching auth globs |
| tree | `tree:digest` node data.digest |
| project_context_hash | sha256 of PROJECT_CONTEXT.md bytes |

Kinds + default severities: SPEC §14.1.

`shouldFailOnDrift(report, fail_on)`: true iff any change severity ∈ `fail_on`.

Formats: `json` | `md` | `sarif` | GitHub annotations when `--ci`.

### 6.2 Query

- Open GraphStore; `searchExcerpts` FTS5
- Boost path keyword hits
- Pack to `max_tokens` (`ceil(chars/4)`)
- Response shape SPEC §15.2 exactly (`tokens_used`, provenance)

Filesystem scan must not be the query backend.

### 6.3 Server

Routes SPEC §16, with:

- `/v1/manifest` → 404 JSON `{ error, hint: "run axictx sync" }` if missing
- `/v1/context` → `{ manifest, nodes, next_cursor }`, default limit 100
- ETag = content_hash; honor If-None-Match → 304
- Auth on `/v1/*` when token set
- **Refuse start** if host is not loopback (`127.0.0.1`, `::1`, `localhost`) AND token empty → exit 1
- OpenAPI lists real routes and auth header

### 6.4 Status

Manifest summary + graph counts from SQLite. Support `--json`.

---

## 7. Phase P3 — SDK, docs, CI, publish AxiContext

### 7.1 SDK `@latticeag/axicontext-sdk`

```typescript
export class AxiContext {
  static async fromRepo(repoRoot?: string): Promise<AxiContext>;
  static async connect(opts: { baseUrl: string; token?: string }): Promise<AxiContext>;

  sync(opts?: SyncOptions): Promise<SyncResult>;
  getManifest(): Promise<Manifest>;
  slice(opts: { topic: string; depth?: number; maxTokens?: number }): Promise<GraphSlice>;
  query(opts: { question: string; maxTokens?: number }): Promise<QueryResult>;
  drift(): Promise<DriftReport>;
}
```

- `fromRepo` calls core in-process
- `connect` uses fetch against Agent Read API

### 7.2 Docs (P0 must exist before publish)

| File | Content |
|------|---------|
| README.md | Accurate quickstart, honest feature list, layout, link SPEC |
| docs/install.md | Node 22, native modules, npm/pnpm |
| docs/config.md | Full TOML reference |
| docs/agent-integration.md | Cursor rule + HTTP slice |
| docs/ci.md | drift workflow snippet |
| CONTRIBUTING.md | pnpm, tests, PR norms |
| SECURITY.md | reporting + local API threat model |
| CHANGELOG.md | 0.1.0 notes |

### 7.3 CI

`.github/workflows/ci.yml`:

1. pnpm install --frozen-lockfile
2. pnpm build
3. pnpm test
4. pnpm typecheck
5. Fixture E2E for `axictx` on `minimal-node-repo`
6. Golden headings check

`.github/workflows/publish.yml`:

- On `v*` tags: publish workspace public packages with npm provenance
- Packages need: `license`, `repository`, `publishConfig.access=public`

### 7.4 Fixtures for AxiContext v0.1.0

| Fixture | Purpose |
|---------|---------|
| `minimal-node-repo` | primary E2E |
| `minimal-python-repo` | pyproject parse |
| `drift-seed-repo` | prebuilt manifest; mutate README → drift |
| `testdata/expected/minimal-node-headings.txt` | golden headings |

Rust/Go sample fixtures for parsers unit tests under `packages/parsers/test/fixtures/` even if full repo fixtures land in P4.

### 7.5 npm packages published in P3

- `@latticeag/axicontext-parsers`
- `@latticeag/axicontext-core`
- `@latticeag/axicontext-adapter-git`
- `@latticeag/axicontext-server`
- `@latticeag/axicontext-sdk`
- `@latticeag/axicontext` (CLI)

Version lockstep `0.1.0`.

---

## 8. Phase P4 — AxiFence v0.1.0

Detail: `SPEC-AxiFence.md`. Summary:

### 8.1 Packages

- `@latticeag/axi-fence-core`
- `@latticeag/axi-fence` (bin `axi-fence`)

### 8.2 CLI

| Command | Behavior |
|---------|----------|
| `axi-fence check [path\|url]` | Analyze; score; exit 0 pass / 1 fail / 3 config |
| `axi-fence run [path\|url]` | Write `.devcontainer/devcontainer.json`, optional compose, `scripts/bootstrap.sh`, `README-SETUP.md` |
| `axi-fence badge [path\|url]` | Print shields.io markdown / JSON |

Global flags: `--json`, `--out <dir>`, `--overwrite`, `--dry-run`, `--no-docker`, `--ci`, `--allow-readme-commands`.

URL input: shallow clone public repo to temp dir, analyze, cleanup. v0.1 is public-first; `GITHUB_TOKEN` / `gh` documented for private follow-up.

### 8.3 Inference

Deterministic rules only. See SPEC-AxiFence.md. No LLM.

### 8.4 Success gate

- 100% of committed Fence fixtures pass `check` + `run --dry-run`
- Node, Python, Rust, Go local fixtures supported
- Compose fixture gets postgres service in generated overlay
- No LLM calls in tests or runtime

### 8.5 Publish

`@latticeag/axi-fence-core` + `@latticeag/axi-fence` at `0.1.0` immediately after P3 (same release train preferred).

---

## 9. Phase P5 — Backlog (not in first build)

- `adapters-github`
- MCP package
- Homebrew / binaries / cosign / SBOM
- Embeddings
- Linear adapter
- Extra CLI: `adapters`, `config`, `export`, `import`, `schema`
- SaaS (Appendix F)
- Fence LLM fallback
- Top-1000 repo research program

---

## 10. Testing contract

| Layer | Requirement |
|-------|-------------|
| Unit | config zod, hash stability, policy redaction, parsers per ecosystem, drift kinds, GraphStore CRUD/FTS |
| Adapter | git adapter on minimal-node (+ python) |
| Integration | server routes, auth, 0.0.0.0 refusal, ETag 304 |
| CLI E2E | init/sync/drift/query on fixture |
| Golden | PROJECT_CONTEXT headings; Fence devcontainer keys |
| Security | planted secrets never appear in MD or excerpt text |
| Fence | check score; dry-run file set; no `.env` values |

Performance budgets: SPEC.md §24 (best-effort; CI fails on functional tests only).

---

## 11. Security contract (ship blockers)

1. Default bind `127.0.0.1`
2. Non-loopback requires non-empty `api_token`
3. Denylist + redaction before graph excerpts and Markdown
4. Graph + cache gitignore suggestions
5. Fence: no real env values; bootstrap is plain shell; no remote pipe installers by default
6. No telemetry
7. Issue content (M2) marked `untrusted`

---

## 12. Implementation checklist

- [x] P0.1 Delete duplicate modules + package-lock.json
- [x] P0.2 Create `packages/parsers` with `analyzeRepo` + tests
- [x] P0.3 Refactor `adapters-git` onto parsers + SPEC node IDs
- [x] P0.4 Invert deps: CLI registry; core has no adapter dependency
- [x] P1.1 Add better-sqlite3; export GraphStore from core index
- [x] P1.2 Rewrite `runSync` → SQLite + config load + injected adapters
- [x] P1.3 Implement `policy.ts` + wire into sync
- [x] P1.4 PROJECT_CONTEXT headings + manual preserve + banner
- [x] P1.5 Config/Zod complete; api_token works; init/doctor complete
- [x] P2.1 Drift digest alignment + fail_on + sarif + annotations
- [x] P2.2 Query via FTS GraphStore
- [x] P2.3 Server SPEC shapes + ETag + bind refuse
- [x] P2.4 CLI flags/exit codes complete; remove dead CLI files
- [x] P3.1 SDK fromRepo/connect
- [x] P3.2 Docs + README honesty + CONTRIBUTING/SECURITY/CHANGELOG
- [x] P3.3 CI E2E + publish workflow + package metadata
- [ ] P3.4 Tag and publish AxiContext 0.1.0
- [x] P4.1 `fence-core` inference + generators + tests
- [x] P4.2 `fence` CLI check/run/badge
- [x] P4.3 Fence fixtures + docs/fence.md
- [ ] P4.4 Publish AxiFence 0.1.0

---

## 13. Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0-build | 2026-07-16 | Locked decisions; phased build contract for AxiContext + AxiFence |

**Next action:** Implement Phase P0 following the checklist in order.
