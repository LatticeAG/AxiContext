# Security

AxiContext is local-first. The OSS CLI does not require a LatticeAG account and does not send repository data to LatticeAG.

## Local files

`axictx sync` creates local state under `.axicontext/`.

Commit:

```text
.axicontext/config.toml
.axicontext/manifest.json
PROJECT_CONTEXT.md
```

Do not commit:

```text
.axicontext/cache/
.axicontext/graph/
.axicontext/state/
.axicontext/*.local.toml
```

The SQLite graph can contain excerpts from source and documentation. Treat it as repository-sensitive data.

## Agent Read API

`axictx serve` starts a local HTTP API. The default bind host is `127.0.0.1`.

Use loopback unless you have reviewed the risk of exposing generated project context to your local network. If you start the server programmatically, the server supports bearer token or `x-api-token` checks when an API token is provided.

## Secrets

Do not store secrets in `PROJECT_CONTEXT.md`, `.axicontext/config.toml`, or files that AxiContext should read. The v0.1 spec includes policy and redaction work; until your installed version includes the policy behavior you require, keep real `.env` files and secret material outside the sync input.

Recommended ignore entries:

```gitignore
.env
.env.*
!.env.example
!.env.sample
.axicontext/cache/
.axicontext/graph/
.axicontext/state/
.axicontext/*.local.toml
```

## CI

CI drift checks should run with the minimum credentials needed to read the repository. AxiContext drift does not need write access or deployment secrets.

## Reporting vulnerabilities

Do not report security vulnerabilities in public issues. Use GitHub private vulnerability reporting for this repository if it is enabled, or contact the maintainers through the private security channel listed for the project.
