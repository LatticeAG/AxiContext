# OSS production readiness plan — AxiContext + AxiFence

**Status:** Planning only. Do not implement until this plan is accepted.  
**Date:** 2026-07-16  
**Scope:** Make AxiContext shippable as OSS v0.1, and specify AxiFence so it can share parsers without inheriting M1 debt.

---

## Verdict

AxiContext has a working CLI scaffold and tests, but it does not yet match SPEC.md on the path that matters for external users: sync does not persist a SQLite graph, drift compares the wrong digest, serve can bind unsafely, policy/redaction is missing, and the README overclaims. AxiFence is a proposal only. Building Fence on today's adapter internals would freeze the wrong APIs.

Ship order: finish AxiContext M1 consolidation and honesty pass first, extract a shared parsers package, then build AxiFence against that package with a full Fence spec.

---

## Current reality (code vs SPEC)

### What works today

- Monorepo + pnpm workspace + vitest + CI build/test/typecheck
- CLI entry `packages/cli/src/axictx-cli.ts` with init / doctor / sync / serve / drift / query / status
- Git adapter ingest on fixture repos
- Hono route stubs and basic auth middleware when a token is passed in code
- In-memory graph during sync, filesystem-based query/drift/server helpers

### What SPEC claims but code does not deliver

| Claim | Reality |
|-------|---------|
| SQLite Context Graph under `.axicontext/graph/` | Sync uses in-memory `graph-store.ts`. SQLite `graphStore.ts` is excluded from build and has no `better-sqlite3` dep in pnpm lock |
| FTS5 query | Keyword scoring over file scans in `query.ts` / `context.ts` |
| Incremental sync | Not implemented |
| Provenance on excerpts | Adapter stores text on node attributes; query responses lack provenance |
| Policy / secret redaction | Absent |
| Core does not depend on adapters | Core depends on `@latticeag/axicontext-adapter-git` |
| Refuse `0.0.0.0` without token | Not enforced; `loadAxiConfig` always clears `api_token` |
| SDK `AxiContext.fromRepo/connect` | Stub re-export of a healthcheck client |
| GitHub Issues adapter | Missing |
| AxiFence | Spec only; no package |

### Known false-positive landmine

Sync writes `manifest.adapters.git.digest` from the adapter snapshot hash. Drift compares that field to `sha256(sorted file list)`. A fresh `sync` can immediately report tree drift. Fix this before any CI drift job goes public.

---

## Principles for the build phase

1. One graph path. SQLite is canonical. Delete or demote the in-memory store after migration.
2. Thin core, fat adapters. Core owns types + GraphStore + sync orchestration. Adapters depend on core types. Core never imports adapter packages.
3. Honest docs. README claims must match shipped behavior before npm publish.
4. Local-only security defaults. Loopback bind, gitignored graph/cache, denylist + redaction before any Markdown leaves the repo.
5. Fence shares parsers, not graph internals. Devcontainer generation is a sibling product, not a sync plugin.

---

## Workstream A — AxiContext M1 consolidation (must ship before npm)

These are the production blockers. Do them in order.

### A1. Kill duplicate modules

**Why:** Parallel build left two of everything. New work will land on the wrong file.

| Keep | Delete / stop exporting |
|------|-------------------------|
| `graphStore.ts` (SQLite) | `graph-store.ts` after sync migrates |
| `constants.ts`, `config.ts`, `types.ts`, `client.ts`, `index.ts` | `axicontext-*`, `axi-index.ts` |
| `axictx-cli.ts` | `bin.ts`, `index.ts` in CLI (or leave unbuilt and delete) |

Acceptance: `packages/core` tsconfig includes SQLite GraphStore; dead files gone; one CLI entry.

### A2. Wire sync → SQLite GraphStore

**Why:** Without this, serve/query/status/drift cannot share one truth, and OSS positioning (graph not flat file) is false.

Pipeline to implement (SPEC §7.3):

1. Load `.axicontext/config.toml` (sync currently ignores it)
2. `GraphStore.open(repoRoot)`
3. Run adapters via registry injected by CLI (not imported by core)
4. Upsert nodes/edges/excerpts with SPEC id patterns
5. Apply policy pack
6. Compute content_hash from stable node/edge/excerpt ids (no timestamps)
7. Write manifest + PROJECT_CONTEXT.md
8. Optional `--fail-on-drift`

Hard requirements:

- Add `better-sqlite3` (and types) to core; document native build needs for Node 22
- Align adapter output to SPEC node/edge enums (`project`, `module`, `file`, `dependency`, `doc`, `commit`, `tree_digest`, …)
- Manifest shape matches SPEC §8.8 so drift can trust digests
- Excerpts get provenance (`adapter`, `path`, `commit`, `ingested_at`, optional lines)

Acceptance: on `minimal-node-repo`, `axictx init && axictx sync` creates `graph.sqlite`, `manifest.json`, and deterministic `PROJECT_CONTEXT.md`. Re-sync without source changes does not flip digests.

### A3. Fix dependency direction

**Why:** Community adapters cannot exist if core hard-imports git.

- Move `GitSourceAdapter` invocation to CLI (or a thin `packages/cli` registry)
- `adapters-git` depends on `@latticeag/axicontext-core` for `SourceAdapter` types
- Delete duplicated `adapters-git/src/types.ts` once core exports the contract

Acceptance: `packages/core/package.json` has no adapter dependency. Sync still works with git adapter enabled by default from CLI.

### A4. Drift engine correctness

**Why:** Broken drift makes CI useless and erodes trust.

- Compare live signals to previous manifest using the same digest definitions sync writes
- Honor `config.drift.fail_on` (default high/critical only)
- Implement kinds that matter for v0.1: `manifest.missing`, `adapter.digest.changed`, `readme.changed`, `dependencies.changed` / added / removed, `auth_paths.changed`, `file_tree.changed`, `project_context_hash.changed`
- Formats: json, md, GitHub annotations; SARIF can wait for M2 unless cheap
- Exit code 2 only when severity ∈ fail_on

Acceptance: fixture with mutated README fails CI; clean re-sync after baseline update exits 0.

### A5. Query + server on the graph

**Why:** Agent Read API is the differentiator. Filesystem re-scan duplicates work and skips provenance.

- Query uses GraphStore FTS + token budget; response includes `tokens_used` and provenance
- Server routes return SPEC shapes; `/v1/manifest` 404s when missing (no silent synthesize)
- ETag from `content_hash` on manifest/context
- Auth: honor `serve.api_token` from config + env; refuse non-loopback bind without token
- OpenAPI stays minimal but accurate for shipped routes

Acceptance: after sync, `axictx query "auth"` and `GET /v1/context/slice?topic=auth` return graph-backed excerpts with paths.

### A6. Policy / redaction (minimum for safe Markdown)

**Why:** Shipping PROJECT_CONTEXT.md without denylist is a secret-leak footgun.

- Denylist globs from config (default SPEC set)
- Default redaction pack: aws key, pem, slack, github token, jwt heuristic
- Apply before excerpts enter graph and before Markdown write
- Do not block M1 on issue-body sanitization (that lands with GitHub adapter)

Acceptance: fixture file matching denylist is never excerpted; planted fake `AKIA…` becomes `[REDACTED:aws_access_key]`.

### A7. PROJECT_CONTEXT.md lock to SPEC §9

- Exact section heading order
- Banner with hash
- Preserve `<!-- axi:manual -->` blocks across sync
- Cap by `max_chars` (drop glossary / provenance detail first)

Acceptance: golden test on fixture headings + manual block survival.

### A8. Init / doctor / exit codes

- Init: gitignore suggestions include `.axicontext/graph/`; idempotent; optional `--overwrite-config`
- Doctor: Node ≥22, config validates, warn non-loopback without token, graph readable if manifest exists
- Sync adapter total failure → exit 4; config errors → 3; drift fail → 2

### A9. Honesty pass (docs + README) before publish

Rewrite README to match reality after A1–A8:

- Correct package paths (`packages/cli`, `core`, …)
- Remove false claims: incremental sync, zero dependencies, FTS if not wired yet
- Quickstart for external users: `npx` / npm global, not only pnpm filter
- Add P0 docs stubs: install, config, agent-integration, ci
- Add CONTRIBUTING.md + SECURITY.md

Acceptance: a stranger can follow README without cloning internals knowledge.

### A10. CI + release gate for v0.1.0

- Fixture E2E in CI: init/sync/drift on `minimal-node-repo`
- Golden heading / content_hash stability test
- Package metadata: license, repository, publishConfig for scoped packages
- Publish workflow (manual or tag-triggered) for `@latticeag/axicontext` and workspace deps
- Defer brew/binaries/SBOM/cosign to v0.1.1 unless free

---

## Workstream B — AxiContext M2 (post first npm, still OSS)

Do not block first publish on these unless product insists.

| Item | Notes |
|------|-------|
| GitHub Issues adapter | Own package; untrusted provenance flag |
| SARIF drift | Nice for security-oriented CI |
| SDK real API | `fromRepo` in-process + `connect` HTTP |
| `axictx adapters` commands | After registry is stable |
| Extra fixtures | `minimal-python-repo`, `drift-seed-repo` |
| MCP package | v0.2 per SPEC |

---

## Workstream C — Shared parsers (bridge to AxiFence)

Extract before writing Fence code. Today parsers are private functions inside `adapters-git`.

### New package: `@latticeag/axicontext-parsers` (or `packages/parsers`)

Export stable, Zod-validated facts (not graph nodes):

- Ecosystem detection (support `mixed`)
- Manifest parsers: package.json (scripts, engines, packageManager, workspaces), pyproject (real TOML), Cargo.toml, go.mod
- Lockfile presence + hash
- Important path discovery (README, docs, workflows, auth paths)
- New for Fence: Dockerfile, docker-compose, Makefile/Justfile, `.env.example`
- Ignore globs shared with git adapter

Consumers:

```text
parsers
  ├─► adapters-git  (maps facts → graph nodes)
  └─► fence-core    (maps facts → devcontainer + bootstrap plan)
```

Acceptance: AxiContext git adapter and a Fence dry-run both import parsers; no private cross-imports from adapter internals.

---

## Workstream D — AxiFence (specify fully, then build)

`SPEC-AxiFence.md` is a product sketch. Promote it to an implementation spec before coding. Keep Fence in this monorepo initially for shared parsers, with independent packages and semver.

### D1. Spec gaps to lock (before any Fence code)

1. **CLI contract**
   - Binary: `axi-fence`
   - Commands: `run`, `check`, `badge` (drop bare `axi-fence <url>` or make it an alias of `run`)
   - Inputs: GitHub URL **or** local path
   - Flags: `--out`, `--overwrite`, `--dry-run`, `--json`, `--no-docker`, `--ci`
   - Exit codes aligned with AxiContext style

2. **Package layout**
   ```text
   packages/parsers/      # shared
   packages/fence-core/   # inference + generators
   packages/fence/        # CLI bin: axi-fence
   ```

3. **Output schemas**
   - `RepoAnalysis` (from parsers)
   - `SetupPlan` (services, package manager, commands, ports, env keys)
   - `CheckReport` (score, blockers, warnings)
   - Generated artifacts: `.devcontainer/devcontainer.json`, optional compose overlay, `scripts/bootstrap.sh`, `README-SETUP.md`

4. **Deterministic inference rules (v1)**
   - Rule-based only for OSS v1. Document LLM fallback as v2 opt-in or omit entirely for first release
   - Node: detect pnpm/npm/yarn from lockfile; runtime from `engines` / `.nvmrc` / `packageManager`
   - Python: uv/poetry/pip from lock/pyproject; runtime from `requires-python`
   - Rust/Go: toolchain from manifests
   - Services: only from docker-compose / well-known deps (postgres, redis) with explicit mapping table
   - Never invent migration/seed commands unless found in package scripts or Makefile targets with known names

5. **Security**
   - Never copy real `.env` values; only scaffold from `.env.example` keys
   - Generated bootstrap scripts must be reviewable plain shell; no curl|bash to third parties by default
   - Treat README-derived commands as untrusted suggestions in check mode; require `--allow-readme-commands` to embed them
   - Clone of public URLs into temp dir with cleanup; no private-repo cloud auth in v1 beyond existing `gh`/`GITHUB_TOKEN`

6. **Testing**
   - Fixtures per ecosystem + one compose-backed app
   - Golden tests for generated devcontainer.json (stable key order)
   - `axi-fence check` CI mode under 10s on fixtures
   - Malicious/malformed manifest fixtures (do not execute unknown scripts during check)

7. **Versioning**
   - Fence packages version independently (`@latticeag/axi-fence`)
   - Depend on parsers with semver range; do not depend on axicontext-core graph

8. **Success criteria (honest first cut)**
   - SPEC's "80% of top 1000 starred repos" is aspirational research, not a v1 gate
   - v1 gate: 100% of committed fixtures pass `run --dry-run` + `check`; Node+Python+Rust+Go local paths supported; URL clone path works for public repos

### D2. Fence build order (after C + AxiContext A1–A3 at least)

1. `fence-core` inference from `RepoAnalysis`
2. Generators for devcontainer + bootstrap + README-SETUP
3. CLI `check` then `run` then `badge`
4. Docs + npm package
5. Optional: Codespaces deep-link helper (not required for OSS v1)

Do not start Fence until parsers exist and AxiContext sync no longer owns private parser functions.

---

## Priority stack (build sequence)

```text
P0  A1 duplicates → A2 SQLite sync → A3 dep direction → A4 drift correct
P0  A5 graph-backed query/server + bind/token hardening
P0  A6 policy/redaction → A7 PROJECT_CONTEXT lock → A8 init/doctor exits
P0  A9 README/docs honesty → A10 CI fixture E2E + publish metadata
─── first npm: @latticeag/axicontext ───
P1  C  extract parsers
P1  D1 lock SPEC-AxiFence.md to implementation grade
P1  D2 fence-core + CLI
P2  B  GitHub adapter, SDK, SARIF, MCP, extra fixtures
```

---

## Explicit non-goals for the first production cut

- SaaS / cloud login / hosted sync (Appendix F)
- Embeddings / MCP (v0.2)
- LLM-based README parsing for Fence v1
- Homebrew / compiled binaries / cosign (v0.1.1+)
- Rewriting in Rust
- Auto-editing user `.gitignore` without consent
- Supporting non-loopback unauthenticated serve

---

## Open decisions to confirm before build

| # | Decision | Recommendation |
|---|----------|----------------|
| 1 | Ship npm when M1 (A1–A10) is green, before GitHub Issues? | **Yes** (matches SPEC M2 split) |
| 2 | Same monorepo for Fence? | **Yes** initially, separate packages |
| 3 | Extract parsers before or after first npm? | **After** first npm if it delays AxiContext; ideally land parsers in the same release train as soon as sync is SQLite-backed |
| 4 | Fence LLM fallback in v1? | **No** — rules only |
| 5 | Keep emoji-heavy README? | **Tone down** for OSS seriousness; optional later |
| 6 | Package name for Fence | `@latticeag/axi-fence`, bin `axi-fence` |

---

## Acceptance snapshot: "production deploy ready OSS"

An external developer can:

1. `npm i -g @latticeag/axicontext` (or `npx`)
2. In their repo: `axictx init && axictx sync`
3. Commit `PROJECT_CONTEXT.md` + `.axicontext/config.toml` + `manifest.json`
4. Run `axictx drift --ci --fail-on-drift` in GitHub Actions without false positives on a clean tree
5. Optionally `axictx serve` on loopback and query slices with provenance
6. Never leak secrets from denylisted paths into Markdown
7. (Fence, once built) `axi-fence check .` and `axi-fence run .` produce reviewable DevContainer artifacts from shared parsers

Until 1–6 are true, treat the repo as pre-release scaffold, not production OSS.

---

## Next step

Review and lock the open decisions above. On approval, implement Workstream A in dependency order on a feature branch, with tests green before touching Fence.
