# AxiContext — OSS Implementation Specification

**Series:** Axi (context / memory) — LatticeAG  
**Product:** AxiContext  
**Scope (locked):** **OSS Phase 1 only** — MIT CLI, SDK, local graph, adapters, Agent Read API  
**SaaS / hosted sync:** Deferred to Phase 2 (see Appendix F)  
**License:** MIT  
**Status:** In active OSS implementation (scaffold landed; consolidation in progress)  
**Spec version:** 1.0.0-oss-draft  
**Repo:** `github.com/LatticeAG/AxiContext`  
**Last updated:** 2026-07-11

---

## 0. Scope Lock & Strategic Context

### 0.1 What we are building now

**Phase 1 = OSS only.** Everything in this document through §28 is in scope for the open-source release. No cloud login, push/pull, invite codes, or hosted dashboard in Phase 1.

| In scope (OSS v0.1) | Out of scope (Phase 2+) |
|---------------------|-------------------------|
| `axictx` CLI (init, sync, serve, drift, query, status, doctor) | `axictx cloud *` commands |
| Local Context Graph (SQLite) | Encrypted bundle sync to LatticeAG SaaS |
| Git source adapter | Managed multi-source sync runners |
| GitHub Issues adapter (v0.1.1) | Drift webhooks / Slack alerts |
| `PROJECT_CONTEXT.md` generator | SSO, BYOK, audit dashboard |
| Local Agent Read API (HTTP/JSON) | Multi-repo org workspace |
| TypeScript SDK | Premium adapter ops at scale |
| Drift detection + CI annotations | |
| Policy / secret redaction | |
| MCP server wrapper (v0.2) | |

### 0.2 Long-term business model (context only — not building now)

LatticeAG's long-term model remains **Hybrid** (OSS adoption engine + hosted SaaS monetization). That decision is unchanged, but **this spec and current sprint execute OSS first**. SaaS is documented only in Appendix F so we do not accidentally bake cloud assumptions into the OSS core.

### 0.3 OSS success definition (v0.1)

A developer can run:

```bash
npm i -g @latticeag/axicontext   # or pnpm / brew / binary
cd my-repo
axictx init
axictx sync
axictx serve                     # optional
axictx drift --ci --fail-on-drift
```

…and get a committed `PROJECT_CONTEXT.md`, a queryable local graph, and CI-friendly drift — **without any network call to LatticeAG**.

### 0.4 Implementation status (as of 2026-07-11)

Parallel build agents landed the OSS scaffold. Status:

| Component | Status | Package / path |
|-----------|--------|----------------|
| Monorepo + pnpm workspace | ✅ Landed | `/` |
| Config TOML + Zod validation | ✅ Landed | `packages/core/src/config.ts` |
| `axictx init` / `doctor` | ✅ Landed | `packages/core/src/init.ts`, CLI |
| Git adapter | ✅ Landed | `packages/adapters-git/` |
| `axictx sync` + Markdown generator | ✅ Landed | `packages/core/src/sync.ts`, `project-context.ts` |
| SQLite GraphStore (alternate impl) | ✅ Landed | `packages/core/src/graphStore.ts` |
| Context summary + manifest readers | ✅ Landed | `packages/core/src/context.ts` |
| Drift engine | ✅ Landed | `packages/core/src/drift.ts` |
| Agent Read API (Hono) | ✅ Landed | `packages/server/` |
| CLI serve/drift/query/status | ✅ Landed | `packages/cli/src/axictx-cli.ts` |
| TypeScript SDK stubs | ✅ Landed | `packages/sdk/` |
| Unified CLI entrypoint | 🔄 In progress | merge `bin.ts` + `index.ts` → `axictx-cli.ts` |
| GraphStore consolidation | ⏳ TODO | `graphStore.ts` vs `graph-store.ts` — pick one |
| GitHub Issues adapter | ⏳ TODO | `packages/adapters-github/` |
| Secret redaction policy pack | ⏳ TODO | `packages/core/src/policy.ts` |
| MCP server | ⏳ v0.2 | `packages/mcp/` |
| npm publish / brew / GH Releases | ⏳ TODO | release pipeline |

---

## 1. Problem Statement

AI coding agents lose project context across sessions, repos, and tools. Hand-written memory files go stale; issue trackers and wikis are disconnected from code; agents re-read entire repositories and burn tokens.

**AxiContext OSS** provides:

1. A **canonical `PROJECT_CONTEXT.md`** generated deterministically from repo signals.
2. A **Context Graph** (SQLite) as machine source of truth under `.axicontext/`.
3. A **local Agent Read API** for structured slices and provenance-backed queries.
4. **Drift detection** so CI catches when live state diverges from recorded context.

**Positioning:** Project context controller — not a chat product, not an agent executor, not a vector DB replacement.

---

## 2. Product Principles (OSS)

1. **Local-only by default.** Zero phone-home in OSS.
2. **Provenance over prose.** Every excerpt links to path/commit/issue.
3. **Deterministic sync.** Same inputs → same `content_hash` (embeddings excluded from hash).
4. **Agent-native.** JSON schemas, stable node IDs, token budgets.
5. **Human escape hatch.** Markdown projection is reviewable; manual override sections supported.
6. **Thin core, fat adapters.** Core stays small; integrations are packages.
7. **CI-first drift.** Loud in CI; soft in interactive use.
8. **Security defaults.** Loopback API, gitignored caches, denylisted paths.

---

## 3. Target Users (OSS beachhead)

**Primary:** Engineers using Cursor or Claude Code on TypeScript/Node or Python repos with GitHub.

| Persona | OSS job |
|---------|---------|
| Coding agent | Minimum true context to change auth safely |
| Staff engineer | Stop architecture memory from rotting |
| DevEx | One convention across agent tools |
| New hire / new agent | Understand repo in minutes |

**Anti-personas for v0.1:** Non-dev consumers, full Glean replacement, agent orchestration (Poly).

---

## 4. Monorepo Architecture

### 4.1 Workspace layout (authoritative)

```text
/
├── SPEC.md                          # this document
├── README.md
├── LICENSE                          # MIT
├── package.json                     # private root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── packages/
│   ├── core/                        # @latticeag/axicontext-core
│   ├── cli/                         # @latticeag/axicontext (bin: axictx)
│   ├── sdk/                         # @latticeag/axicontext-sdk
│   ├── server/                      # @latticeag/axicontext-server
│   ├── adapters-git/                # @latticeag/axicontext-adapter-git
│   └── adapters-github/             # @latticeag/axicontext-adapter-github (v0.1.1)
├── testdata/
│   └── fixtures/
│       ├── minimal-node-repo/
│       ├── minimal-python-repo/
│       └── drift-seed-repo/
├── tests/                           # integration: server routes, drift
└── docs/                            # user docs (post-scaffold)
```

### 4.2 Package dependency graph

```text
adapters-git ──┐
adapters-github┼──► core ◄── sdk
               │      ▲
               │      │
               └──────┼──► server ◄── cli
```

**Rules:**

- `core` must not depend on `cli`, `server`, or adapters (adapters depend on core types only).
- `server` depends on `core` only.
- `cli` depends on `core`, `server`, and dynamically loads adapters at sync time.
- Adapters are separate packages so community can add `adapters-linear` without forking core.

### 4.3 Tech stack (locked for OSS v0.1)

| Layer | Choice | Version constraint |
|-------|--------|-------------------|
| Runtime | Node.js | `>=22` |
| Language | TypeScript | `^5.9` |
| Package manager | pnpm | workspaces |
| CLI parsing | commander | `^14` |
| Config | `@iarna/toml` + zod | |
| HTTP server | Hono + `@hono/node-server` | |
| Graph DB | better-sqlite3 + FTS5 | |
| Glob | fast-glob | |
| Tests | vitest | |
| Hashing | SHA-256 (Node crypto) | deterministic stringify |

**Explicitly not in v0.1:** LLM calls for sync, cloud embeddings, gRPC, Rust rewrite.

---

## 5. On-Disk Layout (per repository)

After `axictx init` + `axictx sync`:

```text
my-repo/
├── PROJECT_CONTEXT.md               # human projection (commit by default)
├── .gitignore                       # should include cache paths (suggested by init)
└── .axicontext/
    ├── config.toml                  # user config (commit)
    ├── manifest.json                # sync metadata + adapter digests (commit)
    ├── graph/
    │   └── graph.sqlite             # Context Graph (gitignore recommended)
    ├── cache/                       # adapter raw caches (gitignore)
    │   └── adapters/
    └── policies/
        └── default.toml             # redaction rules (commit, v0.1.1)
```

### 5.1 Gitignore recommendations (printed by `init`)

```gitignore
.axicontext/cache/
.axicontext/graph/
.axicontext/state/
.axicontext/*.local.toml
```

### 5.2 What to commit (recommendation)

| Path | Commit? | Why |
|------|---------|-----|
| `PROJECT_CONTEXT.md` | **Yes** (default) | Agents work without daemon; visible in PRs |
| `.axicontext/config.toml` | **Yes** | Team-shared adapter settings |
| `.axicontext/manifest.json` | **Yes** | Drift baseline for CI |
| `.axicontext/graph/graph.sqlite` | **No** | Regenerated; large; machine-only |
| `.axicontext/cache/**` | **No** | Ephemeral |

Config escape hatch: `project_context.commit = false` and `manifest.commit = false` (future config key).

---

## 6. Configuration (`config.toml`)

### 6.1 Full schema (v1.0.0)

```toml
schema_version = "1.0.0"

[project]
name = ""                          # empty = autodetect from package.json / folder name
default_branch = "main"

[project_context]
path = "PROJECT_CONTEXT.md"
commit = true
max_chars = 80000
llm_polish = false                 # v0.2+; must stay false in v0.1

[serve]
host = "127.0.0.1"                 # WARN if not loopback without api_token
port = 8787
api_token = ""                     # empty = no auth (loopback only)

[drift]
fail_on = ["high", "critical"]
ignore_paths = ["**/dist/**", "**/coverage/**", "**/node_modules/**"]

[adapters.git]
enabled = true
important_path_globs = ["README*", "docs/**", "**/auth/**", "CODEOWNERS", "LICENSE", "SECURITY.md", ".github/workflows/*"]
recent_commits = 30
max_excerpt_files = 50
max_lines_per_file = 200
tree_max_depth = 3

[adapters.github_issues]
enabled = false
state = "open"                     # open | closed | all
max_issues = 100
label_include = []                 # empty = all
label_exclude = []

[query]
max_tokens_default = 4000
embeddings = "off"                 # off | auto (v0.2)

[policy]
denylist_globs = ["**/.env", "**/*secret*", "**/credentials*", "**/*.pem", "**/*.key"]
redact_patterns = ["default"]
```

### 6.2 Zod validation rules

- `schema_version` must equal `"1.0.0"` for v0.1 (reject unknown major).
- `serve.port` ∈ [1, 65535].
- `drift.fail_on` non-empty array of `low | medium | high | critical`.
- `project_context.max_chars` positive integer, max `500_000` (hard cap).
- Unknown top-level keys: **warn** in v0.1, **reject** in v1.0.

### 6.3 Environment overrides

| Env var | Overrides |
|---------|-----------|
| `AXICTX_REPO_ROOT` | Default repo root for all commands |
| `AXICTX_CONFIG` | Path to alternate config file |
| `AXICTX_SERVE_HOST` | `serve.host` |
| `AXICTX_SERVE_PORT` | `serve.port` |
| `GITHUB_TOKEN` | GitHub Issues adapter |
| `CI=1` | Suppress spinners; force non-interactive |

---

## 7. CLI Specification (`axictx`)

### 7.1 Global behavior

- Binary name: `axictx`
- npm package: `@latticeag/axicontext`
- Default repo root: `process.cwd()` or `AXICTX_REPO_ROOT`
- All commands support `--json` where output is structured (v0.1.1 polish)
- `NO_COLOR=1` respected

### 7.2 Exit codes (locked)

| Code | Name | When |
|------|------|------|
| `0` | Ok | Success |
| `1` | Error | Unexpected failure, adapter crash |
| `2` | Drift | `--fail-on-drift` and severity ∈ `drift.fail_on` |
| `3` | Config | Invalid/missing config |
| `4` | Adapter | One or more adapters failed ingest |

### 7.3 Commands

#### `axictx init`

```bash
axictx init [--overwrite-config] [--yes]
```

**Behavior:**

1. Create `.axicontext/` if missing.
2. Write `config.toml` from `DEFAULT_CONFIG_TOML` unless exists (refuse overwrite without flag).
3. Detect repo type: `node | python | rust | go | mixed | unknown` via manifest files.
4. Create empty `PROJECT_CONTEXT.md` with banner stub if missing.
5. Print `.gitignore` suggestions (do not auto-edit `.gitignore` in v0.1 — user choice).

**Acceptance:** Running twice without `--overwrite-config` is idempotent.

#### `axictx doctor`

```bash
axictx doctor
```

**Checks:**

- Node `>=22`
- `.axicontext/` exists
- `config.toml` parses and validates
- (v0.1.1) `graph.sqlite` readable if manifest exists
- (v0.1.1) warn if `serve.host != 127.0.0.1` and no `api_token`

#### `axictx sync`

```bash
axictx sync [--repo-root PATH] [--dry-run] [--fail-on-drift]
            [--adapters git,github_issues]
            [--max-chars N] [--max-files N] [--max-lines-per-file N]
```

**Pipeline (ordered steps):**

```text
1. Load config.toml
2. Open/create GraphStore at .axicontext/graph/graph.sqlite
3. For each enabled adapter (in dependency order):
   a. adapter.detect(repoRoot) → skip if false
   b. adapter.ingest(ctx) → nodes, edges, digest, warnings
   c. merge into graph (upsert by stable id)
   d. record adapter digest in memory
4. Apply policy pack (redact excerpts, drop denylisted paths)
5. Compute content_hash = sha256(stableStringify({adapters, nodeIds, edgeIds, excerptIds}))
6. Write manifest.json
7. Generate PROJECT_CONTEXT.md from graph + heuristics
8. If --fail-on-drift: run drift engine vs previous manifest; exit 2 if needed
9. Print summary JSON to stdout
```

**Performance target:** `< 30s` for repos ≤10k files (important-file cap, not full tree).

#### `axictx serve`

```bash
axictx serve [--host 127.0.0.1] [--port 8787]
```

- Starts Hono server from `@latticeag/axicontext-server`.
- Loads config for host/port/token.
- **Refuse** `0.0.0.0` without `api_token` (v0.1.1 hardening).
- Blocks until SIGINT.

#### `axictx drift`

```bash
axictx drift [--format json|md|sarif] [--ci] [--fail-on-drift]
```

See §14.

#### `axictx query`

```bash
axictx query "<question>" [--max-tokens 4000] [--json]
```

See §15.

#### `axictx status`

```bash
axictx status [--json]
```

Prints manifest summary + graph stats (node count, excerpt count, adapters, last sync).

#### Deferred commands (documented, not v0.1)

```bash
axictx adapters list|enable|disable|test <name>
axictx config get|set|path
axictx export [--out bundle.json]
axictx import <bundle>
axictx schema print
axictx mcp serve                    # v0.2
```

---

## 8. Context Graph — Data Model

### 8.1 Design principles

- **Stable IDs:** `type:slug` pattern, e.g. `file:src/auth/session.ts`, `dep:express`, `issue:github:42`.
- **Do not graph every file.** Cap important files; store full tree as a single digest node.
- **Provenance on every excerpt.** No orphan text.
- **JSON `data` column** on nodes/edges for extensibility; validate with Zod per `type`.

### 8.2 SQLite DDL (v1)

```sql
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,              -- JSON
  created_at TEXT NOT NULL,        -- ISO-8601 UTC
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS excerpts (
  id TEXT PRIMARY KEY,             -- sha256(text + provenance) or explicit
  text TEXT NOT NULL,
  provenance TEXT NOT NULL         -- JSON Provenance
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  id UNINDEXED,
  text
);

CREATE INDEX IF NOT EXISTS idx_edges_from_id ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_id ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
```

### 8.3 Node types (v1 enum)

| Type | ID pattern | Required `data` fields |
|------|------------|------------------------|
| `project` | `project:{name}` | `name`, `root`, `ecosystems[]` |
| `module` | `module:{path}` | `path`, `name`, `ecosystem` |
| `file` | `file:{posix-path}` | `path`, `role`, `language?` |
| `dependency` | `dep:{eco}:{name}` | `name`, `version`, `ecosystem`, `direct` |
| `issue` | `issue:{provider}:{id}` | `title`, `state`, `labels[]`, `url` |
| `doc` | `doc:{path\|url}` | `title`, `path?`, `url?` |
| `decision` | `decision:{slug}` | `title`, `status`, `path` |
| `commit` | `commit:{sha}` | `sha`, `date`, `message` |
| `tree_digest` | `tree:digest` | `digest`, `file_count`, `depth` |
| `person` | `person:{handle}` | `handle`, `name?` |

### 8.4 Edge types (v1 enum)

| Type | Meaning | Example |
|------|---------|---------|
| `contains` | parent → child | project → module |
| `depends_on` | module → dependency | module → dep:express |
| `documents` | doc → module | README → project |
| `tracked_by` | code → issue | file:auth → issue:42 |
| `decided_in` | decision → module | ADR → auth module |
| `references` | any → any | loose link |
| `authored_by` | commit → person | optional |

### 8.5 Provenance schema

```typescript
interface Provenance {
  adapter: string;           // "git" | "github_issues"
  path?: string;
  start_line?: number;
  end_line?: number;
  commit?: string;           // full sha
  url?: string;
  ingested_at: string;       // ISO-8601 UTC
}
```

### 8.6 GraphStore public API

```typescript
class GraphStore {
  static open(repoRoot: string): GraphStore;

  upsertNode(input: UpsertNodeInput): Node;
  upsertEdge(input: UpsertEdgeInput): Edge;
  addExcerpt(input: AddExcerptInput): Excerpt;

  getNode(id: string): Node | null;
  getSlice(opts: { topic: string; depth: number; maxTokens: number }): GraphSlice;
  searchExcerpts(query: string, limit: number): Excerpt[];

  computeContentHash(): string;
  exportManifest(adapterDigests: Record<string, AdapterDigest>): Manifest;
  writeManifest(manifest: Manifest): void;

  close(): void;
}
```

### 8.7 `getSlice` algorithm (recommendation)

```text
INPUT: topic string T, depth D, maxTokens B

1. Seed nodes = nodes where id/name/path/title fuzzy-matches T (FTS + keyword)
2. If empty, seed = project node + overview excerpts
3. BFS from seeds up to depth D along edges (priority: contains, documents, decided_in, depends_on)
4. Collect excerpts linked to visited nodes (via node.data.excerpt_ids or edges)
5. Pack excerpts greedily by relevance score until token budget B
   - token estimate = ceil(characters / 4)
6. Return { nodes, edges, snippets[], tokens_used, provenance[] }
```

### 8.8 Manifest (`manifest.json`)

```json
{
  "schema_version": "1.0.0",
  "axictx_version": "0.1.0",
  "generated_at": "2026-07-11T13:00:00.000Z",
  "project_root": "/abs/path/to/repo",
  "content_hash": "sha256:abcdef...",
  "project_context_hash": "sha256:...",
  "embedding_model": "none",
  "policy_pack": "default@1",
  "adapters": {
    "git": {
      "digest": "sha256:...",
      "ingested_at": "2026-07-11T13:00:00.000Z",
      "stats": {
        "files_considered": 120,
        "files_excerpted": 7,
        "manifests": 1,
        "lockfiles": 1,
        "commits": 30
      },
      "warnings": []
    }
  },
  "stats": {
    "node_count": 17,
    "edge_count": 19,
    "excerpt_count": 7
  }
}
```

**Drift baseline:** Compare current adapter `digest` values and key signals (§14) to last manifest.

---

## 9. `PROJECT_CONTEXT.md` Generator

### 9.1 Rules

- **Deterministic:** No LLM in v0.1. Template + heuristics only.
- **Stable section order** (always same headings).
- **Banner comment** first line:

```markdown
<!-- axi:generated managed-by=axictx schema=1.0.0 hash=sha256:... -->
```

- **Max length:** `project_context.max_chars` (truncate lowest-priority sections first: glossary → provenance detail).
- **Manual sections:** Content between `<!-- axi:manual -->` … `<!-- /axi:manual -->` preserved across sync.

### 9.2 Section template (locked order)

```markdown
# Project Context

## Overview
## Monorepo / Packages
## Architecture
## Key Entry Points
## Auth & Security
## Data & Storage
## APIs & Integrations
## Tooling & Local Dev
## Open Issues & Active Work
## Decisions (ADRs)
## Glossary
## Provenance & Manifest
```

### 9.3 Heuristic signals for Architecture section

| Signal | Bullet emitted |
|--------|----------------|
| Paths matching `**/auth/**` | Authentication-related modules present |
| `.github/workflows/*` exists | CI/CD via GitHub Actions |
| `next` in dependencies | Next.js frontend detected |
| `express`/`fastify`/`hono` in deps | HTTP service architecture |
| `typescript` in devDependencies | TypeScript toolchain |
| `prisma`/`drizzle` in deps | ORM / database layer |
| `docker-compose.yml` | Containerized local dev |
| Multiple `package.json` in workspaces | Monorepo layout |

### 9.4 Human override path (v0.1.1)

Optional `.axicontext/overview.toml`:

```toml
[overview]
description = """
Custom project description that sync will prepend to Overview.
"""
architecture_notes = [
  "We use event sourcing in the billing module.",
]
```

---

## 10. Source Adapter Interface

### 10.1 TypeScript interface (core)

```typescript
interface RepoContext {
  repoRoot: string;
}

interface IngestContext extends RepoContext {
  config: ResolvedConfig;
  signal?: AbortSignal;
}

interface AdapterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  digest: string;              // sha256 of canonical adapter snapshot
  warnings: string[];
  metadata: Record<string, unknown>;
}

interface SourceAdapter {
  readonly id: string;
  detect(ctx: RepoContext): Promise<boolean>;
  ingest(ctx: IngestContext): Promise<AdapterResult>;
}
```

### 10.2 Adapter execution contract

- **Timeout:** 60s per adapter (configurable).
- **Partial failure:** One adapter failure logs warning; others continue. Exit `4` only if all enabled adapters fail.
- **Deterministic digest:** Hash sorted canonical JSON of adapter-specific snapshot (not filesystem mtime alone).

### 10.3 Adapter registry (compile-time v0.1)

```typescript
const ADAPTERS: Record<string, SourceAdapter> = {
  git: new GitSourceAdapter(),
  github_issues: new GitHubIssuesAdapter(),  // v0.1.1
};
```

**v0.2:** Dynamic import from `config.adapters.*.module` for community adapters.

---

## 11. Git Adapter (`@latticeag/axicontext-adapter-git`)

### 11.1 Detection

- `.git` directory exists, OR
- `git rev-parse --is-inside-work-tree` returns `true`

### 11.2 Ignored paths (always)

```text
**/node_modules/**  **/.git/**  **/dist/**  **/build/**  **/.next/**
**/coverage/**  **/.turbo/**  **/target/**  **/out/**
```

### 11.3 Ingest steps (ordered)

```text
1. project node from folder name + detected ecosystems
2. tree_digest node: walk depth≤3, skip IGNORED dirs, hash sorted relative paths
3. manifest files: package.json, pyproject.toml, Cargo.toml, go.mod, pom.xml
   → module nodes + dependency edges
4. lockfiles: hash only (package-lock.json, pnpm-lock.yaml, yarn.lock, Cargo.lock, go.sum, …)
   → file nodes with role=lockfile, data.hash only
5. important files via IMPORTANT_GLOBS (cap max_excerpt_files)
   → file nodes + excerpts with line ranges + provenance.commit=HEAD
6. recent commits (git log -n N) → commit nodes, authored_by edges optional
7. README / docs: role=readme|doc
8. CI workflows: file nodes role=ci
9. Compute adapter digest = sha256(stableStringify(snapshot))
```

### 11.4 Dependency parsing

| Manifest | Parser |
|----------|--------|
| `package.json` | `dependencies`, `devDependencies` (mark dev separately) |
| `pyproject.toml` | PEP 621 `dependencies` (v0.1.1) |
| `Cargo.toml` | `[dependencies]` |
| `go.mod` | `require` block |

### 11.5 Limits (defaults)

| Limit | Default |
|-------|---------|
| `max_excerpt_files` | 50 |
| `max_lines_per_file` | 200 |
| `recent_commits` | 30 |
| `tree_max_depth` | 3 |

---

## 12. GitHub Issues Adapter (v0.1.1)

### 12.1 Auth

- `gh auth token` via `gh` CLI, OR
- `GITHUB_TOKEN` env var

### 12.2 Ingest

- GraphQL or REST: open issues up to `max_issues`
- Fields: `id`, `number`, `title`, `state`, `labels`, `updated_at`, `url`
- Body: first 500 chars as excerpt; link for full text
- Digest: `sha256(sorted issue id:updated_at:labels)`

### 12.3 PROJECT_CONTEXT section

Under **Open Issues & Active Work:**

```markdown
- #42 [bug] Login redirect loop (https://github.com/org/repo/issues/42)
```

Cap display at 20 issues in Markdown; full set remains in graph.

---

## 13. Policy & Secret Redaction (v0.1.1)

### 13.1 Denylist globs

Never ingest content from paths matching `policy.denylist_globs`.

### 13.2 Redaction patterns (`default` pack)

| Pattern ID | Detects |
|------------|---------|
| `aws_access_key` | `AKIA[0-9A-Z]{16}` |
| `pem_block` | `-----BEGIN .* PRIVATE KEY-----` |
| `slack_token` | `xox[baprs]-...` |
| `github_token` | `ghp_`, `github_pat_` |
| `jwt` | `eyJ...` (heuristic) |

**On match:** Replace with `[REDACTED:pattern_id]` in excerpts; emit `secret_risk` metadata on node (not in Markdown).

### 13.3 Issue body sanitization

Strip HTML; treat issue content as **untrusted** (agent prompt-injection risk). Add `provenance.untrusted = true`.

---

## 14. Drift Engine

### 14.1 Drift kinds

| Kind | Severity default | Detection |
|------|------------------|-----------|
| `manifest.missing` | critical | No manifest.json |
| `adapter.digest.changed` | medium | Any adapter digest differs |
| `content_hash.changed` | info | Graph content hash differs |
| `readme.changed` | medium | README sha differs |
| `dependencies.changed` | medium | Direct dep set differs |
| `dependency.added` | medium | New direct dependency |
| `dependency.removed` | low | Removed direct dependency |
| `auth_paths.changed` | high | Auth-related path set differs |
| `file_tree.changed` | info | Tree digest differs |
| `project_context_hash.changed` | low | Markdown projection changed |

### 14.2 Severity config

`config.drift.fail_on` default: `["high", "critical"]`.

### 14.3 CI GitHub Actions annotations

```text
::warning file=PROJECT_CONTEXT.md,line=1,title=AxiContext Drift::readme.changed - README content changed since last sync
::error file=.axicontext/manifest.json,line=1,title=AxiContext Drift::manifest.missing - run axictx sync
```

### 14.4 Drift report schema

```typescript
interface DriftReport {
  status: "ok" | "drift";
  severity: DriftSeverity;
  generated_at: string;
  changes: DriftChange[];
  summary: { total_changes: number; by_severity: Record<DriftSeverity, number> };
}

interface DriftChange {
  kind: string;
  severity: DriftSeverity;
  detail: string;
  path?: string;
}
```

---

## 15. Query Engine

### 15.1 MVP (v0.1): FTS keyword search

```text
1. Tokenize question → FTS query (AND terms)
2. Rank excerpts by BM25 / fts5 rank
3. Boost excerpts whose node matches topic keywords in path
4. Pack into max_tokens budget
5. Return { question, answer_context[], tokens_used }
```

### 15.2 Response shape

```typescript
interface QueryResult {
  question: string;
  answer_context: Array<{
    text: string;
    path: string;
    start_line?: number;
    end_line?: number;
    tokens: number;
    provenance: Provenance;
  }>;
  tokens_used: number;
  manifest_version: string;
}
```

### 15.3 v0.2: optional embeddings

- `query.embeddings = auto` triggers one-time model download (~30MB).
- Hybrid rerank: FTS candidates → embedding cosine rerank.
- **Never default on** for privacy and binary size.

---

## 16. Agent Read API

### 16.1 Base URL

`http://127.0.0.1:8787` (default)

### 16.2 Endpoints

#### `GET /healthz`

```json
{ "status": "ok", "host": "127.0.0.1", "repo_path": "/abs/path" }
```

#### `GET /v1/manifest`

Returns `manifest.json` or `404` with guidance to run sync.

#### `GET /v1/context?cursor=&limit=`

Paginated graph summary:

```json
{
  "manifest": { ... },
  "nodes": [ ... ],
  "next_cursor": "opaque" | null
}
```

Default `limit=100`.

#### `GET /v1/context/slice?topic=&depth=2&max_tokens=2000`

Returns `GraphSlice` (§8.7).

#### `POST /v1/context/query`

```json
// Request
{ "question": "How does auth work?", "max_tokens": 4000, "include": ["code", "issues"] }

// Response
{ "question": "...", "answer_context": [...], "tokens_used": 1234, "manifest_version": "1.0.0" }
```

#### `GET /v1/drift`

Returns `DriftReport`.

#### `GET /v1/openapi.json`

OpenAPI 3.1 spec for all routes.

### 16.3 Auth

- If `serve.api_token` set: require `Authorization: Bearer <token>` OR `X-API-Token: <token>` on `/v1/*`.
- If empty: no auth (only valid with loopback bind).

### 16.4 Caching headers

- `GET /v1/manifest` and `GET /v1/context`: `ETag` from `content_hash`; honor `If-None-Match`.

### 16.5 MCP wrapper (v0.2 — specified now, build later)

Package: `@latticeag/axicontext-mcp`

| Tool | Behavior |
|------|----------|
| `get_project_context` | slice topic=`overview`, depth=1 |
| `query_context` | POST /v1/context/query |
| `get_drift` | GET /v1/drift |
| `get_manifest` | GET /v1/manifest |

---

## 17. TypeScript SDK

### 17.1 Public API

```typescript
import { AxiContext } from "@latticeag/axicontext-sdk";

const ctx = await AxiContext.fromRepo(".");

await ctx.sync();
const manifest = await ctx.getManifest();
const slice = await ctx.slice({ topic: "authentication", depth: 2, maxTokens: 2000 });
const answer = await ctx.query({ question: "How do I add OAuth?", maxTokens: 4000 });
const drift = await ctx.drift();

// Optional: connect to running server instead of in-process
const remote = await AxiContext.connect({ baseUrl: "http://127.0.0.1:8787" });
```

### 17.2 Implementation modes

| Mode | When |
|------|------|
| In-process | CLI/library calls core directly |
| HTTP client | `connect()` talks to `axictx serve` |

**Recommendation:** Single SDK package; transport is an implementation detail.

---

## 18. Security Model (OSS)

### 18.1 Threats

| Threat | Mitigation |
|--------|------------|
| Local API exposed to LAN | Default loopback; refuse `0.0.0.0` without token |
| Secrets in PROJECT_CONTEXT.md | Denylist + redaction + docs |
| Prompt injection via issues | `untrusted` provenance flag |
| SQLite corruption | WAL mode; backup on sync |
| Dependency confusion in adapters | Pin versions; minimal deps |

### 18.2 Telemetry

**OSS v0.1: none.** No analytics SDK. Optional anonymous crash reports only after explicit opt-in in a future version.

### 18.3 Supply chain

- GitHub Actions: build, test, sign release artifacts (sigstore cosign — v0.1.1).
- SBOM per release (v0.1.1).

---

## 19. Testing Strategy

### 19.1 Test pyramid

| Layer | Location | Focus |
|-------|----------|-------|
| Unit | `packages/*/test/` | config, hash stability, redaction, graph ops |
| Adapter | `packages/adapters-*/test/` | fixture repos |
| Integration | `/tests/` | HTTP routes, drift E2E |
| Golden | `testdata/expected/` | Markdown structure hashes |

### 19.2 Fixture repos

#### `testdata/fixtures/minimal-node-repo/`

- `package.json` with express, typescript
- `src/auth/session.ts`
- `README.md`
- 3 commits
- **Expected:** 17 nodes, 19 edges, architecture bullets for auth + express

#### `testdata/fixtures/minimal-python-repo/` (v0.1.1)

- `pyproject.toml`, `src/mypkg/__init__.py`

#### `testdata/fixtures/drift-seed-repo/` (v0.1.1)

- Prebuilt manifest; test mutates README → expect `readme.changed` medium

### 19.3 Golden hash tests

- `PROJECT_CONTEXT.md` section headings order must not change without semver bump.
- `content_hash` stable across OS for same fixture (posix paths normalized).

### 19.4 CI workflow (`.github/workflows/ci.yml`)

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test
      - run: |
          cd testdata/fixtures/minimal-node-repo
          npx axictx sync
          npx axictx drift --ci --fail-on-drift
```

---

## 20. Distribution

### 20.1 Channels (v0.1 launch)

1. **npm:** `@latticeag/axicontext` (CLI + core bundled)
2. **GitHub Releases:** optional platform binaries via `pkg` or `bun build --compile` (v0.1.1)
3. **Homebrew tap:** `latticeag/tap/axicontext` (v0.1.1)

### 20.2 Versioning

- Semver for all packages; lockstep `0.1.x` during alpha.
- `schema_version` in graph/manifest is independent (graph schema semver).

---

## 21. Documentation Deliverables

| Doc | Audience | Priority |
|-----|----------|----------|
| README quickstart | all | P0 |
| `docs/install.md` | users | P0 |
| `docs/config.md` | users | P0 |
| `docs/agent-integration.md` | Cursor/Claude authors | P0 |
| `docs/ci.md` | DevEx | P0 |
| `docs/schema.md` | adapter authors | P1 |
| `docs/security.md` | security reviewers | P1 |
| `CONTRIBUTING.md` | contributors | P1 |
| `SECURITY.md` | researchers | P1 |

### 21.1 Cursor integration snippet (docs)

```markdown
# .cursor/rules/project-context.mdc
Always read PROJECT_CONTEXT.md before making architectural changes.
For structured context, prefer the local AxiContext API at http://127.0.0.1:8787/v1/context/slice.
```

---

## 22. Implementation Milestones

### M0 — Scaffold ✅ (done)

- [x] pnpm monorepo
- [x] config.toml + zod
- [x] init / doctor
- [x] Git adapter
- [x] sync + PROJECT_CONTEXT.md
- [x] drift + serve + query + status
- [x] Hono API
- [x] minimal fixture + tests

### M1 — Consolidation (current sprint)

- [ ] Single CLI entry (`axictx-cli.ts` has all commands)
- [ ] Merge `graphStore.ts` / `graph-store.ts` into one implementation
- [ ] Wire sync pipeline to SQLite GraphStore (not parallel in-memory store)
- [ ] Add `adapters-git` to build graph
- [ ] Root `pnpm build` builds all packages
- [ ] CI workflow
- [ ] README quickstart accurate

**Acceptance:** `axictx init && axictx sync && axictx drift && axictx serve` works E2E on `minimal-node-repo`.

### M2 — OSS v0.1.0 release

- [ ] GitHub Issues adapter
- [ ] Policy / redaction pack
- [ ] `doctor` graph checks
- [ ] SARIF drift output
- [ ] npm publish `@latticeag/axicontext`
- [ ] Docs P0 set

**Acceptance:** External user can install from npm and run without cloning AxiContext repo.

### M3 — OSS v0.2.0

- [ ] MCP server package
- [ ] Optional embeddings download
- [ ] Linear adapter
- [ ] `axictx adapters` commands
- [ ] Python SDK (thin HTTP client)

### M4 — Phase 2 SaaS (separate spec)

See Appendix F. Not started.

---

## 23. Known Tech Debt (from parallel build)

| Item | Action |
|------|--------|
| Duplicate CLI entrypoints (`bin.ts`, `index.ts`, `axictx-cli.ts`) | Merge into `axictx-cli.ts` |
| Two GraphStore implementations | Keep `graphStore.ts` (SQLite); migrate sync |
| `adapters-git` imports core via relative path | Use package dependency + exported types |
| `sync.ts` in-memory graph vs SQLite | Single SQLite path |
| Duplicate constants (`constants.ts` / `axicontext-constants.ts`) | Delete duplicates |
| Server not in default build filter | Fixed: `pnpm -r build` |
| Exit code `2` for drift | Added `ExitCode.Drift` |

---

## 24. Performance Budgets

| Operation | Target (p95) |
|-----------|--------------|
| `init` | < 1s |
| `sync` (10k files repo) | < 30s |
| `drift` | < 5s |
| `query` (FTS) | < 500ms |
| `GET /v1/context/slice` | < 300ms |
| SQLite graph size | < 50MB typical |

---

## 25. Success Metrics (OSS)

| Metric | Target |
|--------|--------|
| Cold `query` "what is this project?" | < 10s end-to-end including sync on small repo |
| Drift fixture recall | ≥ 90% of seeded changes detected |
| Secret leak in test suite | 0 |
| npm install + init + sync success rate | > 95% on supported platforms |

---

## 26. Open Questions for Product Owner

Spec includes recommendations; confirm or override:

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Commit `PROJECT_CONTEXT.md`? | **Yes** (default) |
| 2 | Commit `manifest.json`? | **Yes** |
| 3 | Graph sqlite in gitignore? | **Yes** |
| 4 | First agent integration doc target? | **Cursor rules + HTTP slice** |
| 5 | GitHub Issues in v0.1.0 or v0.1.1? | **v0.1.1** (don't block first npm publish) |
| 6 | MCP in v0.1 or v0.2? | **v0.2** |
| 7 | Package scope on npm? | **`@latticeag/axicontext`** |

---

## Appendix A — JSON Schema: Node (excerpt)

```json
{
  "$id": "https://axicontext.dev/schemas/v1/node.json",
  "type": "object",
  "required": ["id", "type", "data", "created_at", "updated_at"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z]+:[a-zA-Z0-9._/-]+$" },
    "type": { "enum": ["project", "module", "file", "dependency", "issue", "doc", "decision", "commit", "tree_digest", "person"] },
    "data": { "type": "object" },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

Full schemas exported via `axictx schema print` (v0.2).

---

## Appendix B — Example `axictx sync` stdout

```json
{
  "manifestPath": ".axicontext/manifest.json",
  "projectContextPath": "PROJECT_CONTEXT.md",
  "adapters": ["git"],
  "warnings": [],
  "stats": { "node_count": 17, "edge_count": 19, "duration_ms": 842 }
}
```

---

## Appendix C — Example Drift Markdown

```markdown
# AxiContext Drift Report

- status: **drift**
- severity: **medium**
- generated_at: `2026-07-11T13:30:52.294Z`
- total_changes: 2

## Changes
- [medium] `readme.changed` — README content changed since last sync
- [medium] `dependency.added` — added direct dep jose@5.2.0
```

---

## Appendix D — File Module Map (`packages/core`)

| File | Responsibility |
|------|----------------|
| `constants.ts` | paths, defaults, exit codes |
| `config.ts` | TOML load/validate |
| `init.ts` | scaffold `.axicontext/` |
| `graphStore.ts` | SQLite graph (canonical) |
| `graph-types.ts` | Zod schemas |
| `schema.ts` | DDL |
| `hash.ts` | sha256 + stable stringify |
| `sync.ts` | orchestrate adapters → graph → manifest → md |
| `project-context.ts` | Markdown generator |
| `drift.ts` | drift engine |
| `query.ts` | FTS query |
| `context.ts` | manifest readers, context summary |
| `client.ts` | SDK server/in-process bridge |
| `fs-utils.ts` | safe file walks |
| `types.ts` | shared adapter types |

---

## Appendix E — Cursor / Claude Integration Patterns

### E.1 Static (zero daemon)

```markdown
# CLAUDE.md
Read PROJECT_CONTEXT.md first. It is the canonical project memory generated by AxiContext.
Do not duplicate architecture facts elsewhere.
```

### E.2 Dynamic (daemon)

1. `axictx serve` in devcontainer / local
2. Agent tool calls `GET /v1/context/slice?topic=auth&max_tokens=2000`
3. Agent reads provenance paths for detail edits only

### E.3 CI enforcement

```yaml
- name: AxiContext drift check
  run: npx axictx drift --ci --fail-on-drift
```

---

## Appendix F — Phase 2 Hosted SaaS (deferred)

**Not in scope for current build.** Preserved for strategic context only.

Future capabilities:

- `axictx cloud login|push|pull`
- Encrypted context bundles (AES-256-GCM)
- Workspace RBAC, invites, audit logs
- Drift webhooks → Slack
- Managed adapter runners
- SSO / BYOK enterprise tier

OSS design constraints to preserve for future SaaS:

- Bundle format must be exportable from `axictx export` without cloud.
- Manifest and graph schema remain open.
- Cloud never required for local agent workflows.

---

## Appendix G — Document Control

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0-draft | 2026-07-11 | Initial problem + MVP sketch |
| 0.2.0-draft | 2026-07-11 | Full hybrid planning spec |
| 1.0.0-oss-draft | 2026-07-11 | **OSS scope lock**, implementation-grade detail, monorepo status, parallel build landed, SaaS deferred to Appendix F |

**Next action:** Complete M1 consolidation → M2 npm release.
