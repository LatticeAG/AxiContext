# AxiContext — Specification

**Series:** Axi (context / memory)  
**Product:** AxiContext  
**Pattern:** OSS CLI/SDK (MIT) + invite-only hosted SaaS  
**Status:** Specification / pre-MVP  
**Version:** 0.1.0-draft

---

## 1. Problem Statement

AI coding agents, product managers, and autonomous systems repeatedly lose context when they work across repositories, issues, documents, and conversations. Existing solutions are fragmented:

- `.cursorrules`, `CLAUDE.md`, and `PROJECT_CONTEXT.md` files are hand-written and stale.
- Issue trackers, wikis, Slack threads, and meeting notes are disconnected from the codebase.
- Agents re-read entire repositories on every turn, wasting tokens and producing inconsistent results.
- There is no standard, machine-readable "context API" that agents can query to understand a project.

AxiContext solves this by automatically generating and maintaining a canonical, up-to-date `PROJECT_CONTEXT.md` from repository content, issues, and documentation; exposing it through a versioned agent read API; and detecting drift between the live project state and the recorded context.

---

## 2. Target Users

1. **AI Coding Agents & Agent Frameworks** — need structured, queryable project context without re-reading the whole repo.
2. **Software Teams (10–500 engineers)** — want shared, living project memory that survives team churn and onboarding.
3. **Technical Writers & PMs** — need docs and requirements to stay synchronized with code reality.
4. **Platform / DevEx Engineers** — want to standardize how context is consumed across tools (Cursor, Claude Code, GitHub Copilot, custom agents).
5. **LatticeAG Hosted SaaS Invitees** — teams that want managed context hosting, sync, and drift alerts without operating infrastructure.

---

## 3. Core Concepts

| Term | Definition |
|------|------------|
| **Context Graph** | A normalized graph of project knowledge: files, modules, issues, docs, people, decisions, dependencies. |
| **PROJECT_CONTEXT.md** | Human-readable Markdown summary generated from the Context Graph. The canonical output stored in the repo root. |
| **Source Adapters** | Pluggable readers that ingest data from git repos, GitHub Issues, Notion, Confluence, Linear, Slack, etc. |
| **Drift** | A meaningful difference between the live project state and the generated context (e.g., new issue labels, stale architecture section). |
| **Agent Read API** | A local HTTP/gRPC and SDK interface for agents to query context slices without parsing Markdown. |
| **Context Manifest** | `.axicontext/manifest.json` — metadata, version, adapters, last sync, checksums. |
| **Hosted Sync** | Optional SaaS service that runs ingestion, stores encrypted context, and emits drift events/webhooks. |

---

## 4. Product Positioning

- **Open-core:** MIT-licensed CLI + SDK. Self-hostable and embeddable.
- **Hosted premium:** Invite-only LatticeAG SaaS for teams that want managed sync, collaboration, and drift monitoring.
- **Differentiation:** Not another chat context window. AxiContext is a *project context controller* — a persistent, versioned, queryable memory layer that lives in and alongside the repo.
- **Adjacent LatticeAG series:** AxiContext feeds context *into* Poly (orchestration), Lex (language/model), Vek (vectors/search), and Vis (visualization) products.

---

## 5. API Surface

### 5.1 Local CLI (`axictx`)

```bash
# Initialize context tracking in a repo
axictx init

# Generate PROJECT_CONTEXT.md from sources
axictx sync

# Start local agent read API
axictx serve [--port 8787]

# Check for drift between live state and recorded context
axictx drift [--format json|md]

# Query context (CLI convenience)
axictx query "What is the current auth strategy?"

# Pull/push encrypted context to hosted SaaS
axictx cloud login
axictx cloud pull
axictx cloud push
```

### 5.2 Local Agent Read API

HTTP server bound to `127.0.0.1` by default. No remote exposure without explicit configuration.

```http
GET /v1/context
Accept: application/json
```

Returns the full Context Graph as JSON.

```http
GET /v1/context/slice?topic=authentication&depth=2
Accept: application/json
```

Returns a filtered subgraph focused on a topic.

```http
POST /v1/context/query
Content-Type: application/json

{
  "question": "How do I add a new OAuth provider?",
  "max_tokens": 4000
}
```

Returns grounded context snippets with provenance (file path, line range, issue URL).

### 5.3 SDK

```typescript
import { AxiContext } from "@latticeag/axicontext";

const ctx = await AxiContext.fromRepo(".");
const slice = await ctx.slice({ topic: "authentication", depth: 2 });
const answer = await ctx.query({ question: "...", maxTokens: 4000 });
```

Python and Rust SDKs are secondary targets for the OSS layer.

---

## 6. CLI Commands (Detailed)

### `axictx init`

- Creates `.axicontext/` directory.
- Writes default `config.toml`.
- Detects repo type (Node, Python, Rust, Go, etc.).
- Prompts to enable source adapters.
- Adds `PROJECT_CONTEXT.md` to `.gitignore` recommendation list (optional; user decides).

### `axictx sync`

- Reads all enabled adapters.
- Builds Context Graph.
- Runs drift detection.
- Generates `PROJECT_CONTEXT.md` in repo root.
- Writes `.axicontext/manifest.json`.
- Exits non-zero on critical drift if `--fail-on-drift` is set.

### `axictx serve`

- Starts local API server.
- Default bind: `127.0.0.1:8787`.
- Optional Unix socket mode for containerized agents.
- No authentication by default (local-only). API key auth optional.

### `axictx drift`

- Compares live sources against last generated context.
- Outputs Markdown or JSON report.
- Supports CI mode: `axictx drift --ci` writes GitHub Actions annotations.

### `axictx query`

- Local RAG-style query over context graph.
- Uses local embeddings (default: lightweight CPU model).
- Optional remote embedding provider via config.

### `axictx cloud login|pull|push`

- Authenticates with LatticeAG hosted SaaS.
- Pull/push encrypted context bundles.
- Requires invite code during beta.

---

## 7. Security Model

### 7.1 Local Mode

- All ingestion, embedding, and query happen on the user's machine.
- Agent Read API binds to loopback only.
- No telemetry to LatticeAG unless explicitly opted into cloud sync.
- `PROJECT_CONTEXT.md` is plain text and should be reviewed before commit.

### 7.2 Source Access

- Adapters read only what the local user already has access to.
- GitHub adapter uses `gh` CLI credentials or `GITHUB_TOKEN`.
- Document adapters use user-supplied API tokens stored in OS keychain or `.env`.

### 7.3 Hosted SaaS Mode

- Context bundles are encrypted at rest (AES-256-GCM) and in transit (TLS 1.3).
- LatticeAG cannot read customer context contents; encryption keys are customer-controlled.
- Invite-only during beta. Audit logs available to workspace admins.
- Optional bring-your-own-key (BYOK) for enterprise invites.

### 7.4 Output Safety

- Generated `PROJECT_CONTEXT.md` may contain excerpts from private code/docs. Users control whether it is committed.
- `.axicontext/` may contain embeddings and cached source data; default `.gitignore` template excludes it.

---

## 8. Deployment Model

### 8.1 OSS CLI/SDK

- Distributed via npm, Homebrew, and GitHub Releases.
- Self-contained binary with optional embedding model.
- Works offline after initial sync.

### 8.2 Hosted SaaS (Invite-Only)

- LatticeAG-operated Cloudflare Workers + Durable Objects + R2/S3 backend.
- Encrypted context storage per workspace.
- Webhook endpoint for drift events.
- Admin dashboard for invites, adapters, and audit logs.

### 8.3 Hybrid Mode

- Local `axictx sync` runs as normal.
- `axictx cloud push` uploads encrypted bundle to SaaS.
- CI runners can `axictx cloud pull` to validate context in pipelines.

---

## 9. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Sources                             │
│  git repo │ GitHub Issues │ Notion │ Confluence │ Linear    │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────▼────────────┐
         │   Source Adapters      │
         └───────────┬────────────┘
                     │
         ┌───────────▼────────────┐
         │    Context Graph       │  (normalized, versioned)
         └───────────┬────────────┘
                     │
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
PROJECT_CONTEXT.md  Drift Engine   Agent Read API
     ▼               ▼               ▼
  git commit    CI annotations    Cursor / Claude / Copilot
                     │
         ┌───────────▼────────────┐
         │   Hosted SaaS Sync     │  (optional, invite-only)
         └────────────────────────┘
```

---

## 10. MVP Milestones (6 Days)

### Day 1 — Foundation
- Repo scaffold, MIT license, TypeScript CLI skeleton.
- `axictx init` command.
- `.axicontext/` directory and `config.toml` defaults.

### Day 2 — Git Adapter
- Parse git repository: file tree, README, package manifests, recent commits.
- Build in-memory Context Graph schema.
- Generate first `PROJECT_CONTEXT.md`.

### Day 3 — Agent Read API
- Local HTTP server (`axictx serve`).
- Endpoints: `GET /v1/context`, `GET /v1/context/slice`, `POST /v1/context/query`.
- SDK TypeScript stubs.

### Day 4 — Drift Detection
- Compare live repo state against last manifest.
- Detect new/deleted files, dependency changes, README drift.
- `axictx drift` CLI with JSON/Markdown output.

### Day 5 — GitHub Issue Adapter + Cloud Skeleton
- Ingest open issues and labels.
- Include issue summaries in context.
- Create invite-only cloud workspace schema (no UI).

### Day 6 — Polish + Hosted Push/Pull
- `axictx cloud login`, `push`, `pull`.
- End-to-end test: local sync → cloud push → fresh clone → cloud pull.
- Draft documentation and demo script.

---

## 11. Pricing & Positioning

### OSS
- Free, MIT-licensed.
- All local functionality.
- Community support via GitHub Issues.

### Hosted SaaS (Invite-Only Beta)
- Free during beta for invited teams.
- Post-beta: per-seat pricing, likely $12–$29/seat/month depending on context volume and SLA.
- Enterprise: BYOK, SSO, audit logs, custom adapters — contact sales.

### Value Props
- Reduce agent token spend by 30–60% via structured context.
- Cut onboarding time by keeping project memory current and queryable.
- Prevent "context rot" through automated drift detection.

---

## 12. Open Questions

1. Should `PROJECT_CONTEXT.md` be committed to the repo or kept as a generated artifact?
2. Which embedding model ships with the OSS binary without ballooning size?
3. Should drift detection run on every `git commit` via a hook, or only in CI?
4. What is the initial adapter priority after Git + GitHub Issues?
5. How should multi-repo workspaces be represented in the Context Graph?

---

## 13. Non-Goals (MVP)

- Real-time collaborative editing.
- Fine-grained access control inside the OSS CLI.
- General-purpose vector database replacement.
- Code generation or agent execution (AxiContext is read-only context layer).

---

## 14. Success Metrics

- Time for a new agent to answer "what does this project do?" reduced to < 10 seconds.
- `PROJECT_CONTEXT.md` regeneration time < 30 seconds for repos up to 10k files.
- Drift detection catches 90%+ of meaningful repo changes within one sync.
- Hosted beta NPS > 40.
