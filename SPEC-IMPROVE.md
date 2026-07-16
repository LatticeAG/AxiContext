# SPEC-IMPROVE — Quality upgrade pass (v0.1.1-dev)

**Status:** LOCKED — implement immediately on `cursor/axi-oss-build-a0bf`  
**Date:** 2026-07-16  
**Parent:** `SPEC-BUILD.md` (still authority for architecture)  
**Goal:** Raise every shipped surface from “works” to “feels production OSS”.

---

## 0. Principles

1. No new product scope (no MCP, no SaaS, no LLM Fence).
2. Prefer depth on existing paths: sync, query, drift, serve, fence, docs, tests, CI.
3. Every improvement needs a test or fixture assertion.
4. Keep digests deterministic; never reintroduce false drift after clean sync.

---

## 1. AxiContext improvements

### 1.1 Query quality
- FTS query must rank path hits above weak text hits
- `getSlice` used by server `/v1/context/slice` must return real graph neighborhood when topic matches module/file ids
- Empty results include `hint: "run axictx sync"` when graph missing; when graph present but no hits, `hint: "try fewer keywords"`
- CLI `query` default human output shows path + first line of each excerpt (not only JSON)

### 1.2 Sync / PROJECT_CONTEXT
- Fill Data & Storage / Glossary with better heuristics (prisma/drizzle/sqlite/postgres deps; glossary from README headings)
- Decisions section: detect `docs/adr/**`, `ADR*.md`, `decisions/**`
- Preserve manual blocks (already); add integration test
- Emit `project_context_hash` in manifest always

### 1.3 Drift
- `--json` alias (done) — keep
- Add `axictx drift --quiet` for CI (annotations only when `--ci`, no md body unless format md)
- Severity summary line always present in md

### 1.4 Server
- Consistent error JSON `{ error, hint?, code }`
- `/healthz` includes `axictx_version` and `content_hash` when manifest exists
- CORS not enabled (document); keep loopback default
- Request logging off by default; `AXICTX_SERVE_DEBUG=1` enables simple log lines

### 1.5 CLI UX
- Global `--repo-root` / env `AXICTX_REPO_ROOT` honored by **all** commands (query/status/doctor currently cwd-only in places)
- `status` human output: adapters, node/edge/excerpt counts, last sync time
- Color-safe: respect `NO_COLOR`
- `sync` prints duration_ms in summary (SPEC Appendix B)

### 1.6 Policy
- Redaction integration test: planted secret in fixture file never appears in PROJECT_CONTEXT or excerpts
- Denylist skips `.env` even if mistakenly in important globs

### 1.7 SDK
- `slice` works in-process via GraphStore.getSlice
- Better errors when repo not synced

---

## 2. Parsers / adapter improvements

### 2.1 Parsers
- Detect `.tool-versions` / `.nvmrc` / `.node-version` / `.python-version` into runtime_hints
- Parse compose ports even when short form `"5432:5432"`
- `packageManager` field from package.json (`pnpm@9` → pnpm)
- Stable digest ignores absolute paths (already) — add test for path portability

### 2.2 Git adapter
- Cap excerpt lines per file from config
- Prefer HEAD commit sha on provenance
- Include SECURITY.md / LICENSE as file nodes with roles

---

## 3. AxiFence improvements

### 3.1 Inference
- Read `.env.example` keys into `env_keys` and document in README-SETUP
- Detect Next/Vite ports from deps/scripts into `forward_ports`
- Prefer `packageManager` from package.json over lockfile when both present? **Lockfile wins** (keep); document
- Compose fixture bootstrap includes note about waiting for postgres

### 3.2 CLI
- `run` without `--overwrite` refuses existing generated files with exit 3 and clear message
- `badge` colors: pass green, fail red, score in label
- Progress-free CI mode already — ensure `--ci` suppresses tips

### 3.3 Security
- Fixture with real-looking secret in `.env` — assert never copied into outputs

---

## 4. Tests / CI / docs

### 4.1 Golden + E2E
- Test that consumes `testdata/expected/minimal-node-headings.txt`
- Integration test: init→sync→drift(0)→query(auth hit) in `tests/e2e-cli.test.ts`
- Fence dry-run test on compose-node-repo asserts postgres service file present

### 4.2 CI
- Workflow runs e2e test (via pnpm test)
- Cache pnpm store

### 4.3 Docs
- README: dual quickstart (axictx + axi-fence), accurate feature table, remove any leftover overclaim
- `docs/fence.md` examples match real flags
- CHANGELOG: add Unreleased / 0.1.1-dev notes for this improve pass

---

## 5. Implementation checklist

- [ ] I1 Query ranking + hints + human CLI output
- [ ] I2 Global repo-root on all CLI commands + status human view + sync duration_ms
- [ ] I3 PROJECT_CONTEXT heuristics (storage, ADR, glossary)
- [ ] I4 Server healthz version/hash + error shape + debug log flag
- [ ] I5 Policy secret fixture test
- [ ] I6 Parsers runtime files + packageManager + digest portability test
- [ ] I7 Fence env_keys, ports, overwrite refuse, secret fixture, badge label
- [ ] I8 SDK in-process slice + clear unsynced errors
- [x] I9 Golden headings test + e2e-cli + fence compose test
- [x] I10 README/docs/CHANGELOG + CI pnpm cache

---

## 6. Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0-improve | 2026-07-16 | Quality upgrade pass over shipped v0.1 scaffold |
