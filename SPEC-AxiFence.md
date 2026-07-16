# SPEC-AxiFence: One-Click Local Dev Environment

> **Status:** Proposal
> **Type:** Feature spec

## Problem

"I want to contribute to this open-source project, but setting it up takes 2 hours." Dependencies, env vars, databases, build tools — each repo has its own undocumented setup ritual. DevContainers exist as a standard but creating them is manual.

## Relationship to AxiContext

AxiContext already reads codebases and generates structured project context. AxiFence extends the same analytical engine to generate *dev environments* instead of context files.

| Feature | AxiContext | AxiFence |
|---------|-----------|----------|
| Input | GitHub URL / local repo | GitHub URL |
| Analysis | Language, framework, schema | + Dependencies, services, setup steps |
| Output | PROJECT_CONTEXT.md + SQLite graph | devcontainer.json + setup script |
| Target | AI coding agents | Human developers |

## Solution

A CLI tool that takes any GitHub URL and produces a ready-to-code dev environment:

1. **Analyze the repo** — Reads package.json, pyproject.toml, Cargo.toml, Dockerfile, docker-compose.yml, Makefile, README
2. **Infer the stack** — Detects language, framework, database, build system
3. **Generate devcontainer.json** — Full DevContainer config with all inferred settings
4. **Generate setup script** — bootstrap.sh that installs deps, creates env files, runs migrations, seeds data
5. **Open in VSCode** — "Reopen in Container" with everything ready

## Architecture

```
CLI: axi-fence <github-url>
  ↓
Repo Analyzer (reuses AxiContext parsers)
  ├── package.json → Node, exact version, scripts, deps
  ├── pyproject.toml → Python, build backend, deps
  ├── Cargo.toml → Rust, deps, features
  ├── Dockerfile → base image, ports, volumes
  ├── docker-compose.yml → service topology (DB, cache, queue)
  ├── Makefile / Justfile → build targets
  ├── .env.example → env var template
  └── README → setup instructions (NL-parsed for common patterns)
  ↓
Inference Engine
  ├── Determines setup difficulty score
  ├── Generates devcontainer.json
  ├── Creates bootstrap setup script
  ├── Docker compose for backing services
  └── Generates README-SETUP.md (one-page start guide)
  ↓
Launch → "Reopen in Container" or "Open in Codespaces"
```

## Key Design Decisions

- **Rule-based first.** 80% of repo analysis is deterministic (parse known config files). LLM fallback for edge cases only.
- **DevContainer format.** Not a proprietary format — works with any DevContainer tool (VSCode, JetBrains, Codespaces).
- **CI mode.** `axi-fence check <github-url>` validates that a repo CAN be setup automatically. Returns a pass/fail score.
- **Docker Compose integration.** If repo needs Postgres/Redis, spin them up automatically.

## Implementation Notes

- Reuses AxiContext's parser library — language detection, dependency extraction already exist
- LLM usage: only for unconventional build systems or when README parsing is ambiguous
- Output path: `axi-fence run <url>` generates files in `.devcontainer/` and `scripts/`
- Badge system: `axi-fence badge <url>` generates a shield.io badge for repo READMEs

## Success Criteria

- 80% of top 1000 starred repos pass automated setup
- From URL to running dev environment: <2 minutes
- Supports Node, Python, Rust, Go in v1
- CI check completes in <10 seconds per repo
