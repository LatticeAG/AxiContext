# AxiContext — Product & Technical Specification

**Series:** Axi (context / memory) — LatticeAG  
**Product:** AxiContext  
**Working title alternatives:** AxiCtx, Axi Memory, Project Context Controller  
**Pattern (decision):** **Hybrid — OSS-first open-core + invite-only hosted SaaS**  
**License (OSS layer):** MIT  
**Status:** Specification / pre-MVP — planning only (no implementation yet)  
**Version:** 0.2.0-draft  
**Repo:** `github.com/LatticeAG/AxiContext`  
**Last updated:** 2026-07-11

---

## 0. Executive Verdict

### Crucial decision: OSS, SaaS, or Hybrid?

**Recommendation: Hybrid (OSS-first open-core + hosted SaaS).**

| Option | Verdict | Why |
|--------|---------|-----|
| **Pure OSS** | Reject as sole model | Agents and DevEx tools only win adoption if they live in the repo and local toolchain. Pure OSS builds trust and distribution, but alone it does not fund managed sync, multi-source adapters ops, drift alerting, SSO, or a durable business for LatticeAG. |
| **Pure SaaS** | Reject as sole model | Coding-agent context must work offline, in air-gapped CI, and inside private repos without shipping source to a vendor by default. Pure SaaS fights trust, Cursor/Claude local workflows, and enterprise security reviews. |
| **Hybrid (chosen)** | **Ship this** | MIT CLI/SDK/local graph is the adoption engine. Invite-only hosted SaaS is the monetization and team-collaboration layer (encrypted sync, webhooks, dashboard, enterprise adapters). This matches how successful agent-adjacent tools win (open local core + paid cloud). |

**Why Hybrid is the best fit for AxiContext specifically:**

1. **Trust boundary:** Context is often private code + issues + docs. Local-first is non-negotiable; cloud must be opt-in and encrypted.
2. **Distribution:** Agents (Cursor, Claude Code, Copilot, custom) integrate via CLI/SDK/local API far faster than via a login wall.
3. **Network effects:** OSS adapters and `PROJECT_CONTEXT.md` convention can become a de-facto standard; SaaS rides that standard.
4. **LatticeAG series:** AxiContext OSS feeds Poly / Lex / Vek / Vis; hosted SaaS is the shared control plane across the series later.
5. **Monetization without killing adoption:** Charge for *operation* (sync, alerts, multi-repo, SSO, BYOK), not for *reading context locally*.

**Open-core boundary (firm recommendation):**

| Free / OSS (always) | Paid / Hosted SaaS |
|---------------------|--------------------|
| `axictx` CLI (init, sync, serve, drift, query) | Managed multi-source sync runners |
| Local Context Graph + embeddings cache | Encrypted context storage & workspace sharing |
| Git + GitHub Issues adapters | Premium adapters ops (Slack/Notion/Confluence at scale) |
| Local Agent Read API + TypeScript SDK | Drift webhooks, Slack/email alerts, dashboard |
| `PROJECT_CONTEXT.md` generator | Multi-repo org graph, invite/RBAC, audit logs |
| Self-hostable single-node (docs + docker compose) | SSO/SAML, BYOK, SLA, enterprise support |

**Do not** put the core graph schema, local query, or Markdown generator behind a paywall. That would kill agent adoption.

---

## 1. Problem Statement

AI coding agents, PMs, and autonomous systems repeatedly lose project context when they work across repositories, issues, documents, and conversations. Existing approaches are fragmented and brittle:

- **Hand-written memory files** (`.cursorrules`, `CLAUDE.md`, `AGENTS.md`, `PROJECT_CONTEXT.md`) go stale within days.
- **Issue trackers, wikis, Slack, and meeting notes** are disconnected from the codebase the agent actually edits.
- **Agents re-ingest entire repositories** every session, wasting tokens and producing inconsistent answers.
- **No standard machine-readable “context API”** exists for agents to ask: *What is this project? What changed? What decisions bind me?*
- **Onboarding and team churn** destroy tribal knowledge; new agents and new humans both start cold.
- **“Context rot”** is silent: architecture sections, auth strategies, and open RFCs diverge from reality without alarms.

**AxiContext** solves this by:

1. Automatically generating and maintaining a canonical, up-to-date `PROJECT_CONTEXT.md` from repository content, issues, and documentation.
2. Maintaining a normalized **Context Graph** under `.axicontext/`.
3. Exposing a **versioned Agent Read API** (local HTTP + SDK) so agents query structured slices with provenance—not raw Markdown dumps.
4. Detecting **drift** between live project state and recorded context, with CI-friendly exits and annotations.
5. Optionally syncing **encrypted** context bundles to LatticeAG hosted SaaS for team sharing, alerts, and multi-repo memory.

**One-line positioning:** AxiContext is a *project context controller* — persistent, versioned, queryable memory that lives in and alongside the repo.

---

## 2. Vision & Product Principles

### 2.1 Vision (12–24 months)

Every serious software repository has a living context layer that agents and humans both trust: generated Markdown for humans, a graph + API for machines, drift alarms for truth, and optional hosted sync for teams.

### 2.2 Principles (non-negotiable)

1. **Local-first, cloud-optional.** Default path never phones home.
2. **Provenance over vibes.** Every claim in context links to file/issue/doc evidence.
3. **Deterministic sync where possible.** Same inputs → same graph hash (embeddings may be annotated as non-deterministic).
4. **Agent-native DX.** Prefer JSON schemas, stable IDs, and small token budgets over prose walls.
5. **Human-readable escape hatch.** `PROJECT_CONTEXT.md` remains reviewable and editable as a *projection*, not the sole source of truth.
6. **Fail loud on drift in CI; fail soft in interactive use.**
7. **Security by default:** loopback API, gitignored caches, customer-controlled encryption for cloud.
8. **Thin core, fat adapters.** Core stays small; integrations are plugins.
9. **Compose with LatticeAG series** — do not become Poly (orchestration), Lex (models), Vek (general vectors), or Vis (UI viz).
10. **Boring reliability over clever RAG demos.** Correct, fresh, small context beats flashy chat.

### 2.3 Jobs To Be Done

| Actor | Job |
|-------|-----|
| Coding agent | “Give me the minimum true context to change auth safely.” |
| Staff engineer | “Keep architecture memory from rotting after the last RFC.” |
| New hire / new agent | “Understand this monorepo in minutes, not days.” |
| DevEx | “Standardize how Cursor/Claude/custom agents load project memory.” |
| PM / writer | “See when docs diverge from code and open issues.” |
| Security/compliance | “Prove what left the laptop if we enable cloud sync.” |

---

## 3. Target Users & Personas

### 3.1 Primary (MVP)

1. **AI Coding Agents & Framework Authors** — Cursor rules authors, Claude Code users, custom agent builders. Need structured, queryable context without full-repo re-read.
2. **Platform / DevEx Engineers** (teams ~10–500) — want one convention across tools.
3. **Staff+/Architect engineers** — own architectural truth and hate stale `CLAUDE.md` files.

### 3.2 Secondary (post-MVP / SaaS)

4. **Technical Writers & PMs** — sync requirements/docs with code reality.
5. **Engineering managers** — onboarding time and knowledge continuity.
6. **LatticeAG Hosted invitees** — managed sync, drift alerts, multi-repo without ops.

### 3.3 Anti-personas (do not optimize MVP for)

- Non-technical solo “chat with my Notion” consumers (different product).
- Teams wanting AxiContext to *execute* agents or generate product code (that’s Poly / Lex).
- Enterprises demanding full Glean/replacement search on day one.

### 3.4 Recommendation: beachhead

**Beachhead = TypeScript/Node and Python repos using Cursor or Claude Code, with GitHub Issues.**  
Win there, publish the `PROJECT_CONTEXT.md` + Agent Read API convention, then expand adapters and languages.

---

## 4. Competitive Landscape & Differentiation

| Approach | Gap | AxiContext angle |
|----------|-----|------------------|
| Hand-written `CLAUDE.md` / `.cursorrules` | Stale, no drift, not queryable | Generated + drift + API |
| Full-repo RAG / codebase chat | Expensive, noisy, no canonical summary | Curated graph + token-budgeted slices |
| GitHub Copilot Workspace / agent memories | Vendor-locked, opaque | OSS local standard + optional cloud |
| Notion AI / Glean | Not repo-native, heavy SaaS | Repo-native first |
| Internal “context.md” scripts | One-off, no schema, no SDK | Productized schema + adapters + CI |

**Differentiation line to keep repeating:** Not another chat context window. A *controller* for project memory: generate, version, query, drift-detect, optionally sync.

---

## 5. Core Concepts

| Term | Definition |
|------|------------|
| **Context Graph** | Normalized, versioned graph of project knowledge: files, modules, packages, issues, docs, people, decisions, dependencies, ADRs. Source of truth under `.axicontext/`. |
| **PROJECT_CONTEXT.md** | Human-readable Markdown *projection* of the graph. Canonical *committed* artifact by default (see §12 recommendation). |
| **Source Adapters** | Pluggable ingest: git, GitHub Issues, Linear, Notion, Confluence, Slack, etc. |
| **Drift** | Meaningful difference between live sources and last recorded graph/manifest. |
| **Agent Read API** | Local HTTP (and later gRPC optional) + SDK for agents to fetch slices with provenance. |
| **Context Manifest** | `.axicontext/manifest.json` — schema version, adapters, timestamps, content hashes, embedding model id. |
| **Context Bundle** | Encrypted export of graph + manifest + optional embeddings for cloud pull/push. |
| **Slice** | Filtered subgraph for a topic/path/issue with depth and token budget. |
| **Provenance** | Evidence pointers: path, line range, commit SHA, issue URL, doc URL, adapter id. |
| **Hosted Sync** | Optional SaaS: store bundles, run managed ingest, emit drift events/webhooks. |
| **Workspace** | SaaS org unit spanning one or more repos. |
| **Policy Pack** | Rules for what may enter context (secret redaction, path denylist, max excerpt length). |

---

## 6. Product Requirements Overview

### 6.1 Must-have (MVP)

- `axictx init|sync|serve|drift|query`
- Git adapter (tree, README, manifests, recent commits, basic language detection)
- GitHub Issues adapter (open issues + labels + milestones)
- Context Graph schema v1 + `manifest.json`
- `PROJECT_CONTEXT.md` generator (stable section order)
- Local Agent Read API: `GET /v1/context`, `GET /v1/context/slice`, `POST /v1/context/query`
- TypeScript SDK stubs matching API
- Drift detection for files, deps, README, issue set hash
- Secret redaction + path denylist
- Cloud skeleton: invite-gated `login|push|pull` of encrypted bundles (minimal dashboard optional for MVP)
- MIT license, docs: quickstart + schema + security model

### 6.2 Should-have (v0.2–0.3)

- GitHub Actions: `axictx drift --ci`
- Optional commit hook (off by default)
- Linear adapter
- Python SDK
- Docker compose self-host for team local server
- Hosted drift webhooks + email/Slack notify
- Multi-repo workspace (SaaS)

### 6.3 Could-have (later)

- Notion / Confluence / Slack adapters
- ADR ingestion (`docs/adr/**`)
- Rust SDK / single static binary via Bun compile or equivalent
- gRPC Agent API
- Visual Context Graph in Vis product
- Auto-PR that updates `PROJECT_CONTEXT.md` on drift

### 6.4 Won’t (non-goals) — see §22

---

## 7. User Journeys

### 7.1 Solo engineer + Cursor (OSS)

1. `npm i -g @latticeag/axicontext` (or brew / binary).
2. `axictx init` in repo → `.axicontext/config.toml`, gitignore suggestions.
3. `axictx sync` → `PROJECT_CONTEXT.md` + graph.
4. Point Cursor/Claude to “read PROJECT_CONTEXT.md first” *or* `axictx serve` + MCP/HTTP tool.
5. Before PR: `axictx drift`; fix or re-sync.
6. Commit `PROJECT_CONTEXT.md` + config (not embeddings cache).

### 7.2 Team CI gate (OSS)

1. CI runs `axictx sync --check` or `axictx drift --ci --fail-on-drift`.
2. Annotations show stale architecture section / new critical dependency.
3. Human updates sources or accepts regenerated context via PR.

### 7.3 Hosted team (Hybrid)

1. Admin receives invite → creates workspace → connects GitHub App.
2. Devs `axictx cloud login` with device flow.
3. `axictx sync && axictx cloud push` (or SaaS-managed sync on push webhook).
4. Drift webhook → Slack channel; dashboard shows history.
5. New clone: `axictx cloud pull` bootstraps context before first full sync.

### 7.4 Agent query path

1. Agent calls `POST /v1/context/query` with question + `max_tokens`.
2. API returns snippets + provenance + graph node IDs.
3. Agent answers grounded in those snippets; may fall back to file reads for details.

---

## 8. CLI Surface (`axictx`)

### 8.1 Command map

```bash
axictx init [--force] [--yes]
axictx sync [--fail-on-drift] [--adapters git,github] [--dry-run]
axictx serve [--port 8787] [--host 127.0.0.1] [--socket PATH]
axictx drift [--format json|md|sarif] [--ci] [--fail-on-drift]
axictx query "<question>" [--max-tokens 4000] [--json]
axictx status
axictx adapters list|enable|disable|test <name>
axictx config get|set|path
axictx doctor                 # env, tokens, schema, disk
axictx cloud login|logout|whoami|push|pull|status
axictx export [--out bundle.axicrypt]
axictx import <bundle>
axictx schema print           # JSON Schema for graph
```

### 8.2 Recommendations (CLI UX)

- **Binary name:** `axictx` (short); package `@latticeag/axicontext`.
- **Colors + sparklines optional;** always support `NO_COLOR` and `--json` for automation.
- **Exit codes:** `0` ok, `1` generic error, `2` drift failed, `3` auth/config, `4` adapter failure.
- **Progress:** show adapter phases on TTY; quiet in CI (`CI=1`).
- **Idempotent `init`:** refuse overwrite unless `--force`.
- **`doctor`:** first-class; saves support burden.

### 8.3 Detailed command behavior

#### `axictx init`

- Creates `.axicontext/` (`config.toml`, `graph/` placeholder, `.gitignore` template for cache).
- Detects package ecosystem(s): Node, Python, Rust, Go, Java, mixed monorepo.
- Interactive adapter enablement; `--yes` enables `git` only.
- **Recommendation:** Suggest committing `config.toml` + `PROJECT_CONTEXT.md`; gitignore `graph/embeddings/`, `cache/`, `*.sqlite`.

#### `axictx sync`

- Runs enabled adapters → merge into Context Graph → policy pack (redaction) → write graph artifacts → regenerate Markdown → update manifest → optional drift report.
- `--dry-run`: print planned writes + drift without mutating.
- `--fail-on-drift`: exit `2` if severity ≥ configured threshold.

#### `axictx serve`

- Default `127.0.0.1:8787`.
- Optional Unix socket for containers.
- Optional `--token` / config API key if binding non-loopback (warn loudly).
- Health: `GET /healthz`.

#### `axictx drift`

- Compares live adapter digests vs manifest.
- Formats: Markdown (human), JSON (tools), SARIF (GitHub code scanning-friendly).
- `--ci`: GitHub Actions workflow commands / annotations.

#### `axictx query`

- Local retrieval over graph + optional embeddings.
- Default: hybrid keyword + embedding; CPU-local model.
- Always print provenance in human mode.

#### `axictx cloud *`

- Device-code or browser login; store refresh token in OS keychain (fallback: `~/.config/axicontext/credentials.json` with 0600).
- Push/pull encrypted bundles; invite code required in beta.

---

## 9. Agent Read API

### 9.1 Transport

- **MVP:** HTTP/JSON on loopback.
- **Later:** optional gRPC; optional MCP server wrapper (`axictx mcp`) — **strong recommendation** to ship MCP early (v0.2) because Cursor/Claude ecosystem is MCP-shaped.

### 9.2 Endpoints (v1)

```http
GET /healthz

GET /v1/context
Accept: application/json
→ full graph summary + manifest (paginate large graphs via ?cursor=)

GET /v1/context/slice?topic=authentication&depth=2&max_tokens=2000
→ filtered subgraph + excerpts + provenance

POST /v1/context/query
{
  "question": "How do I add a new OAuth provider?",
  "max_tokens": 4000,
  "include": ["code", "issues", "docs"],
  "repo_path": "."
}
→ { "answer_context": [...snippets], "nodes": [...], "manifest_version": "..." }

GET /v1/manifest
GET /v1/drift
GET /v1/openapi.json
```

### 9.3 API recommendations

- **Version in path** (`/v1`); never break without bump.
- **ETag / `If-None-Match`** on `GET /v1/context` for agent caches.
- **Token budgets are first-class** — agents pass `max_tokens`; server enforces hard cap from config.
- **No remote bind by default.** Document danger of LAN bind.
- **CORS:** disabled by default; only needed for local web UIs explicitly enabled.

### 9.4 MCP tool mapping (recommended v0.2)

| MCP tool | Maps to |
|----------|---------|
| `get_project_context` | slice of overview nodes |
| `query_context` | `/v1/context/query` |
| `get_drift` | `/v1/drift` |
| `get_manifest` | `/v1/manifest` |

---

## 10. SDKs

### 10.1 TypeScript (primary, MVP)

```typescript
import { AxiContext } from "@latticeag/axicontext";

const ctx = await AxiContext.fromRepo(".");
const slice = await ctx.slice({ topic: "authentication", depth: 2, maxTokens: 2000 });
const result = await ctx.query({ question: "How do I add OAuth?", maxTokens: 4000 });
const drift = await ctx.drift();
```

**Recommendations:**

- Dual use: library can run sync/query in-process *or* talk to `axictx serve`.
- Publish types; Zod or JSON Schema shared with CLI.
- Tree-shakeable; no telemetry SDK required for OSS core.

### 10.2 Python (v0.2)

- `pip install axicontext`; mirror TS API for agent frameworks (LangGraph, etc.).

### 10.3 Rust (later)

- Only if binary size / embedding pipeline needs it; don’t block MVP.

---

## 11. Context Graph — Data Model (v1 recommendation)

### 11.1 Storage layout

```text
.axicontext/
  config.toml
  manifest.json
  graph/
    nodes.jsonl          # or nodes.sqlite — see recommendation below
    edges.jsonl
    excerpts/            # content-addressed excerpt blobs
  cache/
    adapters/            # adapter raw digests
    embeddings/          # gitignored
  policies/
    default.toml
```

**Storage recommendation:** Start with **SQLite** (`graph.sqlite`) for nodes/edges/FTS — simpler queries, single file, easy backup. Keep JSONL export as `axictx export --format jsonl` for debuggability. JSONL-only is fine for tiny MVP day 1–2, but SQLite should be the near-term default.

### 11.2 Node types

| Type | Examples | Key fields |
|------|----------|------------|
| `project` | root | name, description, primary_language, repo_url |
| `module` | packages/workspaces | path, name, ecosystem |
| `file` | important files only (not every file) | path, role (`readme`,`config`,`entrypoint`,`adr`,…) |
| `symbol` | optional later | name, kind, file, range |
| `dependency` | npm/pip/cargo deps | name, version, eco, direct/transitive |
| `issue` | GitHub/Linear | id, title, labels, state, url |
| `doc` | wiki/notion page | title, url, updated_at |
| `decision` | ADR | status, date, path |
| `person` | CODEOWNERS / committers (optional) | name, handle |
| `api` | OpenAPI routes (optional) | method, path |
| `secret_risk` | redaction hits (meta) | pattern_id, path |

**Recommendation:** Do **not** graph every file. Cap “important files” via heuristics: README, manifests, `src/**/index.*`, `app/**/page.*`, OpenAPI, Terraform roots, `docs/**`, CODEOWNERS, CI workflows, auth modules (path keywords). Full tree lives as a **digest**, not millions of nodes.

### 11.3 Edge types

`contains`, `depends_on`, `implements`, `documents`, `tracked_by`, `decided_in`, `owned_by`, `references`, `drifts_from` (computed).

### 11.4 Provenance object (every node/excerpt)

```json
{
  "adapter": "git",
  "path": "src/auth/oauth.ts",
  "start_line": 40,
  "end_line": 88,
  "commit": "abc123",
  "url": "https://github.com/org/repo/blob/abc123/src/auth/oauth.ts#L40-L88",
  "ingested_at": "2026-07-11T12:00:00Z"
}
```

### 11.5 Manifest (`manifest.json`)

```json
{
  "schema_version": "1.0.0",
  "axictx_version": "0.1.0",
  "generated_at": "...",
  "project_root": ".",
  "content_hash": "sha256:...",
  "adapters": {
    "git": { "digest": "sha256:...", "stats": { "files_considered": 120 } },
    "github_issues": { "digest": "sha256:...", "open_count": 42 }
  },
  "embedding_model": "none|model-id",
  "policy_pack": "default@1",
  "project_context_hash": "sha256:..."
}
```

### 11.6 Schema evolution

- Semver `schema_version`.
- Migrations in CLI; refuse unknown major without `--migrate`.
- Publish JSON Schema at `axictx schema print` and in docs.

---

## 12. `PROJECT_CONTEXT.md` Format

### 12.1 Commit or generate-only?

**Recommendation: Commit `PROJECT_CONTEXT.md` by default.**

| Pros of committing | Cons |
|--------------------|------|
| Agents work with zero daemon | Merge conflicts |
| Visible in PRs / reviewable | Can go stale if CI not enforced |
| Works in GitHub web UI | Noise in diffs |

**Mitigations:** Stable section order; “machine-managed” banner; CI drift gate; optional `axictx sync --write-pr` later.  
**Config escape hatch:** `project_context.commit = false` for teams that prefer artifact-only.

### 12.2 Recommended section skeleton (stable order)

```markdown
<!-- axi:generated managed-by=axictx schema=1.0.0 hash=... -->
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

### 12.3 Rules

- Banner comment with schema + hash.
- Hard max length configurable (default ~800–1500 lines / ~50–80k chars) — **prefer smaller**.
- No secrets; redact aggressively.
- Architecture prose: prefer bullets from detected signals over LLM fluff in MVP.
- **MVP generation recommendation:** template + heuristics first; optional LLM polish behind `--llm` flag and explicit API key (off by default). Deterministic core builds trust.

### 12.4 Human edits

**Recommendation:** Treat human edits as *hints* via `PROJECT_CONTEXT.override.md` or `config.toml [overview] description = """..."""` rather than editing the generated file. If users edit generated file, next sync overwrites unless sections marked `<!-- axi:manual -->` … `<!-- /axi:manual -->`.

---

## 13. Source Adapters

### 13.1 Adapter interface (recommendation)

```typescript
interface SourceAdapter {
  id: string;
  detect(ctx: RepoContext): Promise<boolean>;
  ingest(ctx: IngestContext): Promise<AdapterResult>; // nodes, edges, digest, warnings
}
```

- Timeout + partial failure isolation per adapter.
- Capability flags: `requires_network`, `requires_secret`, `supports_incremental`.

### 13.2 Priority order (recommendation)

| Priority | Adapter | MVP? | Notes |
|----------|---------|------|-------|
| P0 | `git` | Yes | Always on |
| P0 | `github_issues` | Yes | Via `gh` or `GITHUB_TOKEN` |
| P1 | `linear` | Soon | High PM overlap |
| P1 | `markdown_docs` | Soon | `docs/**`, ADR folders |
| P2 | `github_prs` | Later | Open PR themes |
| P2 | `notion` | SaaS-skewed | Token heavy |
| P2 | `confluence` | Enterprise | |
| P3 | `slack` | Careful | Noise; summary-only |
| P3 | `jira` | Enterprise | |
| P3 | `figma`/`miro` | No | Out of scope early |

### 13.3 Git adapter details

Ingest:

- Root README / docs README
- Package manifests & lockfile hash (not full lockfile body)
- Language/framework fingerprints
- Top-level tree summary
- Recent commits (N=30 default): messages only
- CI config presence
- CODEOWNERS / LICENSE / SECURITY.md
- Auth-looking paths heuristic list
- Important file excerpts (bounded)

### 13.4 GitHub Issues adapter

- Open issues (paginate cap configurable)
- Labels, milestones, assignees (handles only)
- Issue body truncated; link out for full text
- Digest = hash of sorted issue id+updated_at+labels

---

## 14. Drift Engine

### 14.1 What counts as drift

| Signal | Severity default |
|--------|------------------|
| `content_hash` changed | info |
| README / Overview source changed | medium |
| Dependency major bump / new direct dep | medium–high |
| Auth path files changed | high |
| New/closed issues beyond threshold | low–medium |
| Manifest schema mismatch | high |
| Secret redaction policy hit new paths | high |

### 14.2 Recommendations

- Severity levels: `info | low | medium | high | critical`.
- Config: `fail_on = ["high","critical"]` for CI.
- Don’t fail CI on every new issue; use thresholds / label filters (`architecture`, `security`).
- Emit structured drift events for SaaS webhooks: `axictx.drift.detected`.

### 14.3 When to run

| Mode | Recommendation |
|------|----------------|
| Local pre-commit hook | **Off by default**; `axictx init` offers opt-in |
| Pre-push | Optional |
| CI on PR | **On by default in docs template** |
| Nightly SaaS | Hosted customers |

---

## 15. Query & Embeddings

### 15.1 MVP query

**Recommendation:** Hybrid **FTS (SQLite) + structured graph navigation**; embeddings optional.

- Without embeddings: still useful via topics, paths, labels, keywords.
- With embeddings: improve `axictx query` quality.

### 15.2 Embedding model recommendation

| Option | Verdict |
|--------|---------|
| Ship large local LLM embedder in binary | No — size bomb |
| Default **no embeddings**; FTS-only | Good for day-1 |
| Optional download of small model (e.g. ~20–50MB ONNX / GGUF class) on first `query` | **Best** |
| Cloud embeddings (OpenAI etc.) | Opt-in only; never default for OSS privacy |

Store `embedding_model` in manifest; changing model invalidates embedding cache.

### 15.3 Token budgeting

- Server-side packing: overview → decisions → matching modules → excerpts.
- Deduplicate overlapping excerpts.
- Always reserve tokens for provenance lines.

---

## 16. Configuration

### 16.1 `config.toml` (recommended shape)

```toml
schema_version = "1.0.0"

[project]
name = ""                          # autodetected if empty
default_branch = "main"

[project_context]
path = "PROJECT_CONTEXT.md"
commit = true
max_chars = 80000
llm_polish = false

[serve]
host = "127.0.0.1"
port = 8787
api_token = ""                     # empty = no auth (loopback only)

[drift]
fail_on = ["high", "critical"]
ignore_paths = ["**/dist/**", "**/coverage/**"]

[adapters.git]
enabled = true
important_path_globs = ["README*", "docs/**", "**/auth/**"]
recent_commits = 30

[adapters.github_issues]
enabled = false
state = "open"
max_issues = 100
label_include = []                 # empty = all

[query]
max_tokens_default = 4000
embeddings = "auto"                # off | auto | required

[cloud]
enabled = false
workspace = ""
endpoint = "https://api.latticeag.com"

[policy]
denylist_globs = ["**/.env", "**/*secret*", "**/credentials*"]
redact_patterns = ["default"]      # named packs
```

Env overrides: `AXICTX_*`, standard `GITHUB_TOKEN`.

---

## 17. Security, Privacy & Trust

### 17.1 Local mode

- Loopback-only API by default.
- No telemetry unless explicit opt-in (`axictx telemetry enable`) — **recommendation: off entirely in MVP**; add anonymous counters later only with clear prompt.
- Caches gitignored.
- `doctor` warns if serve bound to `0.0.0.0` without token.

### 17.2 Secrets

- Deny path globs + regex redaction pack (AWS keys, PEMs, Slack tokens, etc.).
- Never put raw `.env` into graph.
- Cloud bundles: encrypt **before** upload; LatticeAG ciphertext-only storage.

### 17.3 Hosted encryption recommendation

- **Envelope encryption:** per-workspace data key; customer passphrase or KMS/BYOK wraps data key.
- AES-256-GCM for bundles; TLS 1.3 in transit.
- **Beta claim:** “LatticeAG cannot read plaintext context” only if keys are customer-controlled — do not market zero-knowledge if server-managed keys exist. Be honest:  
  - **Tier A (default hosted):** server-managed keys + strict access control (simpler UX).  
  - **Tier B (enterprise):** BYOK / customer-held keys (true limited visibility).  
- **Recommendation:** Ship Tier A for invite beta with clear docs; design bundle format for Tier B from day one.

### 17.4 Supply chain

- Signed GitHub Release binaries (sigstore/cosign).
- SBOM for releases.
- Minimal dependency surface in CLI.

### 17.5 Threat model (document in SECURITY.md)

Actors: local malware, malicious adapter config, compromised SaaS, curious LatticeAG operator, prompt-injection via issue bodies.

**Mitigations:** sanitize issue HTML/Markdown into plain text; mark untrusted node content; agents should treat issue-derived context as untrusted input.

---

## 18. Hosted SaaS (LatticeAG) Spec

### 18.1 Beta posture

- Invite-only.
- Free during beta.
- Feature focus: encrypted push/pull, workspace membership, drift webhooks, basic audit log — **not** a heavy analytics suite.

### 18.2 Resources

- Workspace, members, invites, repos, bundles, webhook endpoints, API keys (machine), audit events.

### 18.3 Recommended infra (aligned with existing draft)

- Cloudflare Workers + Durable Objects + R2 for bundles/metadata.
- GitHub App for managed sync (post-MVP).
- Queue for drift evaluation jobs.

### 18.4 API (hosted, sketch)

```http
POST /v1/workspaces
POST /v1/workspaces/:id/invites
POST /v1/repos/:id/bundles   # upload encrypted
GET  /v1/repos/:id/bundles/latest
POST /v1/webhooks
GET  /v1/audit
```

CLI maps to these via `axictx cloud *`.

### 18.5 Dashboard (minimal)

- List repos + last sync + last drift severity.
- Invite codes / members.
- Webhook config.
- Audit log table.

**Recommendation:** Defer polished UI; CLI-first beta is fine. A thin admin page is enough.

---

## 19. Deployment & Distribution

### 19.1 OSS

- npm: `@latticeag/axicontext` (CLI via `bin`).
- Homebrew tap (LatticeAG).
- GitHub Releases: platform binaries.
- Optional Docker image for `serve` in Compose.

### 19.2 Offline

- After sync + optional model download, query/serve work offline.
- Cloud commands fail gracefully offline.

### 19.3 Self-host

- Document single-node Docker Compose for teams that want shared LAN server **without** LatticeAG SaaS (graph served behind their auth).  
- Full multi-tenant self-host of SaaS control plane is **non-goal** for year one (support cost).

---

## 20. Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         Sources                             │
│  git repo │ GitHub Issues │ Linear │ Docs │ (Notion…)       │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────▼────────────┐
         │   Source Adapters      │  (plugins, isolated failures)
         └───────────┬────────────┘
                     │
         ┌───────────▼────────────┐
         │   Policy / Redaction   │
         └───────────┬────────────┘
                     │
         ┌───────────▼────────────┐
         │    Context Graph       │  SQLite + manifest
         └───────────┬────────────┘
                     │
     ┌───────────────┼────────────────────────┐
     ▼               ▼                        ▼
PROJECT_CONTEXT.md  Drift Engine      Agent Read API / MCP / SDK
     ▼               ▼                        ▼
  git commit     CI annotations      Cursor / Claude / Copilot / Poly
                     │
         ┌───────────▼────────────┐
         │ Hosted SaaS Sync (opt) │  encrypted bundles, webhooks
         └────────────────────────┘
```

### 20.1 Recommended tech stack (MVP)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | **TypeScript (Node 22+)** | Speed of CLI/SDK shipping; agent ecosystem is TS-heavy |
| CLI framework | **citty or commander** + **consola** | Lightweight |
| HTTP | **Hono** or Node `http` | Tiny local server |
| DB | **better-sqlite3** or **libsql** | Local graph/FTS |
| Config | TOML (`smol-toml` / `@iarajs/toml`) | Human-friendly |
| Validation | **Zod** | Share with SDK |
| Tests | **Vitest** | Fast |
| CI | GitHub Actions | Native drift annotations |
| Hosted | Cloudflare Workers + DOs + R2 | Fits LatticeAG draft; global edge |
| Package | pnpm monorepo optional | `packages/cli`, `packages/sdk`, `packages/graph`, `packages/adapters-*` |

**Alternative considered:** Rust CLI — better single binary, slower MVP. Revisit after product-market fit.

### 20.2 Monorepo layout recommendation

```text
/
  SPEC.md
  README.md
  LICENSE
  packages/
    cli/
    sdk/
    core/          # graph, sync, drift, policy
    adapters-git/
    adapters-github/
    server/        # serve + openapi
  apps/
    hosted-api/    # SaaS (private or same repo gated)
  examples/
  docs/
```

**Recommendation:** Keep hosted API in-repo but clearly separated; avoid early polyrepo tax.

---

## 21. Integrations

### 21.1 Cursor

- Document rule snippet: read `PROJECT_CONTEXT.md` first; optional MCP.
- Example `.cursor/rules` fragment in docs (user opts in).

### 21.2 Claude Code

- `CLAUDE.md` pointer: “Defer to PROJECT_CONTEXT.md for living truth; do not duplicate.”

### 21.3 GitHub Actions

```yaml
# recommended template
- uses: latticeag/axicontext-action@v1  # future
  with:
    fail-on-drift: true
```

Until action exists: `npm i` + `npx axictx drift --ci --fail-on-drift`.

### 21.4 LatticeAG series

| Product | Relationship |
|---------|--------------|
| **Poly** | Consumes Agent Read API as context provider for orchestration |
| **Lex** | Optional LLM polish / query reformulation — never required for core sync |
| **Vek** | Optional remote vector index for large orgs; local FTS remains default |
| **Vis** | Graph visualization of Context Graph |

**Boundary rule:** AxiContext does not schedule agents, fine-tune models, or own general-purpose search UX.

---

## 22. Non-Goals

### MVP non-goals

- Real-time collaborative editing of context
- Fine-grained ACL inside OSS CLI
- Replacing Glean / Sourcegraph / Elasticsearch
- Code generation / autonomous coding
- Mobile apps
- Slack as a primary knowledge base (too noisy)
- Guaranteeing perfect architecture prose without human override fields
- Multi-tenant self-hosted SaaS appliance

### Explicit forever-careful

- Training LatticeAG models on customer context — **default no; contractual no for paid**
- Reading customer plaintext with server-managed keys without audit — minimize; prefer BYOK for sensitive customers

---

## 23. MVP Milestones (execution plan)

> Note: Prior draft used a compressed “6 days” framing. Below is the same spirit as an **engineering sequence**, not a calendar promise. Scope is intentionally MVP-tight.

### Milestone A — Foundation

- Repo scaffold, MIT, TS monorepo, `axictx` skeleton
- `init`, `config.toml`, directory layout, `doctor`

### Milestone B — Git → Graph → Markdown

- Git adapter + SQLite/JSON graph v1
- `PROJECT_CONTEXT.md` generator (deterministic)
- `sync` + `manifest.json`

### Milestone C — Agent Read API + SDK

- `serve` endpoints + OpenAPI
- TS SDK `fromRepo` / `slice` / `query` (FTS)
- Example Cursor/Claude snippets in docs

### Milestone D — Drift + CI

- Drift engine + `drift --ci`
- GitHub Action example workflow
- Exit codes + SARIF optional

### Milestone E — GitHub Issues + Policy

- Issues adapter
- Redaction/denylist policy pack
- Query improvements

### Milestone F — Cloud skeleton + polish

- Invite-only `cloud login|push|pull`
- Bundle encryption format v1
- Quickstart, SECURITY.md, demo script
- Decision log for open questions below

**Cut line if slipping:** Hosted push/pull can ship as “format + mock endpoint” behind feature flag; do not block local excellence on SaaS UI.

---

## 24. Pricing & Packaging (post-beta recommendation)

### OSS

- Free MIT: full local product surface (§0 table).

### Hosted (post-beta starting point)

| Tier | Price (rec.) | Includes |
|------|--------------|----------|
| Beta | $0 invite | Encrypted sync, 1–2 repos, webhooks experimental |
| Team | **$16/seat/mo** (anchor; was $12–29 band) | N repos, drift alerts, audit, 30-day retention |
| Enterprise | Sales | BYOK, SSO, custom adapters, retention, MSA |

**Packaging principle:** Meter **repos + seats + retention + managed sync minutes**, not query counts (queries should feel free locally forever).

### Value props (measurable claims — validate in beta)

- Reduce agent preamble token spend **30–60%** vs full-repo dumps (measure in examples).
- Onboarding “what is this system?” answerable in **< 10s** via query/slice.
- Drift catch rate target **≥ 90%** of seeded meaningful changes in test fixtures.

---

## 25. Go-to-Market & Community

1. **Launch OSS** with killer demo: before/after token counts on a public repo.
2. Publish **Context Graph schema** as a small open standard; invite adapter PRs.
3. Cursor / Claude community posts + example repos.
4. Invite-only SaaS for design partners (5–15 teams).
5. Don’t lead with “AI platform”; lead with **less stale context, less token waste, CI drift**.

---

## 26. Documentation Plan

Must-ship docs:

- README quickstart (5 minutes)
- `docs/schema.md` — graph + manifest
- `docs/security.md` — threat model, encryption honesty
- `docs/adapters.md`
- `docs/ci.md`
- `docs/agent-integration.md` (Cursor, Claude, MCP)
- `docs/cloud.md`
- `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`

---

## 27. Testing Strategy

| Layer | Approach |
|-------|----------|
| Unit | Graph merge, redaction, manifest hash stability |
| Fixture repos | Tiny sample repos in `testdata/` with expected Markdown hashes |
| Adapter mocks | Recorded GitHub API fixtures |
| API contract | OpenAPI + Vitest supertest |
| E2E CLI | `vitest` spawning CLI on fixtures |
| Drift golden | Mutate fixture → expect severities |
| Security | Tests that `.env` never enters graph |
| Cloud | Contract tests against local encrypted round-trip |

**Recommendation:** Snapshot tests for Markdown structure, not for every prose line if LLM polish exists (keep LLM off in CI).

---

## 28. Observability

### OSS

- Structured logs to stderr; `--verbose`.
- No remote telemetry by default.

### SaaS

- Request metrics, sync success rates, drift event counts.
- Audit log for push/pull/login/invite.
- Customer-visible status page later.

---

## 29. Compliance & Legal

- MIT for OSS.
- Customer ToS + DPA for SaaS before GA.
- GDPR: export/delete workspace; EU R2/region story when enterprise asks.
- Do not ingest customer data into training sets by default; document explicitly.
- CLA or DCO for contributors — **recommendation: DCO** (lighter).

---

## 30. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Generated Markdown is low-quality / generic | Heuristics + manual override fields; optional LLM later |
| Merge conflict hell on PROJECT_CONTEXT.md | Stable ordering; small file; CI bot PR strategy |
| Scope creep into full RAG platform | Hard non-goals; adapter plugin model |
| Secret leakage into committed context | Policy pack + CI secret scan recommendation |
| SaaS trust concerns | Local-first; honest encryption tiers; invite design partners |
| Adapter maintenance burden | Few P0 adapters; community P2+ |
| Competing with vendor-native memories | Standardize on open file + API; be the portable layer |

---

## 31. Success Metrics

### Product

- Cold query “what does this project do?” **< 10s** locally on mid-size repo.
- `sync` **< 30s** for ≤10k files (important-file capped).
- Drift detection ≥ **90%** on fixture suite.
- Hosted beta NPS **> 40**.

### Adoption

- GitHub stars / npm downloads (leading indicators).
- Number of repos with committed `PROJECT_CONTEXT.md` banner hash.
- Design-partner weekly active syncs.

### Quality

- Zero critical secret-leak reports in beta.
- SDK/API breaking changes only with semver major.

---

## 32. Open Questions — with Recommendations

| # | Question | Recommendation | Confidence |
|---|----------|----------------|------------|
| 1 | Commit `PROJECT_CONTEXT.md` or artifact-only? | **Commit by default**; config to disable | High |
| 2 | Embedding model in OSS binary? | **FTS default; optional small model download** | High |
| 3 | Drift on every commit hook? | **CI default; hooks opt-in** | High |
| 4 | Adapter priority after Git + Issues? | **Linear + markdown/ADR docs** | High |
| 5 | Multi-repo graph? | **OSS = one repo; SaaS workspace links repos** | High |
| 6 | LLM-generated architecture prose in MVP? | **No by default; `--llm` opt-in later** | High |
| 7 | MCP server timing? | **v0.2 right after HTTP API** | High |
| 8 | SQLite vs JSONL graph? | **SQLite near-term; JSONL export** | High |
| 9 | Hosted encryption tier for beta? | **Server-managed keys + design for BYOK; honest docs** | Medium |
| 10 | Monorepo package manager? | **pnpm** | Medium |
| 11 | Should cloud be separate private repo? | **Same repo, `apps/hosted-api`, clear boundaries** | Medium |
| 12 | Name lock: AxiContext vs axictx vs Axi Memory? | **Product AxiContext, CLI `axictx`, npm `@latticeag/axicontext`** | High |
| 13 | gRPC? | **Defer; HTTP+MCP enough** | High |
| 14 | Windows first-class? | **Yes for CLI paths; CI matrix later** | Medium |
| 15 | Auto-PR updating context? | **Post-MVP; powerful for enterprises** | Medium |

### Questions for you (product owner)

Answer when convenient; SPEC already encodes recommendations above:

1. **Brand:** Confirm **AxiContext** / LatticeAG series naming is final for public launch.
2. **Encryption honesty:** Prefer simpler Tier A beta UX, or delay cloud until BYOK Tier B is ready?
3. **Design partners:** Do you already have 3–5 invite teams, or should GTM assume OSS-only for first weeks?
4. **Primary agent surface:** Optimize first demo for **Cursor MCP**, **Claude Code**, or **raw HTTP**?
5. **Monorepo ambitions:** Is LatticeAG planning a single “Axi” umbrella repo soon, or keep AxiContext standalone?
6. **Languages:** Any must-have non-TS customer (Go/Java shop) for beta that should affect beachhead?
7. **SaaS region / Cloudflare:** Confirm Cloudflare stack is the org standard.
8. **Budget posture:** Is hosted beta allowed to be loss-leading (recommended: yes)?

---

## 33. Acceptance Criteria for “Spec Complete → Build”

Planning is sufficient to start Milestone A when:

- [x] Hybrid model decided and open-core boundary written
- [x] MVP command/API list frozen
- [x] Graph node/edge types v1 listed
- [x] Security posture and encryption honesty documented
- [x] Non-goals explicit
- [x] Milestone cut line defined
- [ ] Product owner confirms or overrides §32 recommendations (esp. commit Markdown, encryption tier, first agent surface)

---

## 34. Appendix A — Example Agent Slice Response (illustrative)

```json
{
  "topic": "authentication",
  "max_tokens": 2000,
  "nodes": [
    { "id": "module:src/auth", "type": "module", "path": "src/auth" },
    { "id": "decision:adr-0003", "type": "decision", "title": "Use OAuth2 + sessions" }
  ],
  "snippets": [
    {
      "text": "OAuth providers are registered in src/auth/providers.ts ...",
      "provenance": {
        "adapter": "git",
        "path": "src/auth/providers.ts",
        "start_line": 1,
        "end_line": 40,
        "commit": "abc123"
      }
    }
  ],
  "manifest_version": "1.0.0",
  "content_hash": "sha256:…"
}
```

## 35. Appendix B — Drift JSON (illustrative)

```json
{
  "status": "drift",
  "severity": "high",
  "changes": [
    {
      "kind": "dependency.added",
      "severity": "medium",
      "detail": "added direct dep jose@5.2.0"
    },
    {
      "kind": "file.changed",
      "severity": "high",
      "path": "src/auth/session.ts"
    }
  ]
}
```

## 36. Appendix C — Glossary

- **Open-core:** OSS core product + commercial hosted features.
- **Projection:** Derived view (Markdown) of canonical graph.
- **Digest:** Hash summarizing adapter inputs for drift.
- **Policy pack:** Named redaction/deny ruleset.
- **Bundle:** Encrypted portable context artifact for SaaS.

---

## 37. Document Control

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0-draft | 2026-07-11 | Initial SPEC (problem, MVP sketch, hybrid lean) |
| 0.2.0-draft | 2026-07-11 | Full planning expansion: OSS/SaaS/Hybrid decision, open-core boundary, journeys, graph schema, adapters, security tiers, SaaS, GTM, risks, recommendations on all open questions |

**Next step after owner review:** Freeze v1.0.0-spec → begin Milestone A (scaffold only). **No application code in this planning phase.**
