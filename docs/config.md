# Config

`axictx init` writes `.axicontext/config.toml`.

Current default:

```toml
schema_version = "1.0.0"

[project]
name = ""
default_branch = "main"

[project_context]
path = "PROJECT_CONTEXT.md"
commit = true
max_chars = 80000

[serve]
host = "127.0.0.1"
port = 8787

[drift]
fail_on = ["high", "critical"]

[adapters.git]
enabled = true

[adapters.github_issues]
enabled = false
```

## Fields

### `schema_version`

Required. The current schema version is `"1.0.0"`.

### `[project]`

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | Optional project name. Empty means AxiContext can infer from the repo. |
| `default_branch` | string | Branch name used for repo metadata and docs. |

### `[project_context]`

| Field | Type | Meaning |
|-------|------|---------|
| `path` | string | Markdown output path. Defaults to `PROJECT_CONTEXT.md`. |
| `commit` | boolean | Whether this file is expected to be committed. |
| `max_chars` | integer | Maximum generated Markdown size. |

### `[serve]`

| Field | Type | Meaning |
|-------|------|---------|
| `host` | string | Host passed to the local Agent Read API. Defaults to `127.0.0.1`. |
| `port` | integer | Port passed to the local Agent Read API. Defaults to `8787`. |

The server implementation supports API-token checks when started programmatically with a token. The current TOML loader does not yet read an `api_token` field.

### `[drift]`

| Field | Type | Meaning |
|-------|------|---------|
| `fail_on` | array | Drift severities that should fail when `--fail-on-drift` is used. |

Allowed values are `low`, `medium`, `high`, and `critical`.

### `[adapters.git]`

| Field | Type | Meaning |
|-------|------|---------|
| `enabled` | boolean | Enables local git and filesystem ingestion. |

### `[adapters.github_issues]`

| Field | Type | Meaning |
|-------|------|---------|
| `enabled` | boolean | Reserved for the GitHub Issues adapter described in the spec. |

## CLI overrides

`axictx sync` accepts:

```bash
axictx sync --repo-root . --max-chars 80000 --max-files 80 --max-lines-per-file 120
```

`axictx serve` accepts:

```bash
axictx serve --host 127.0.0.1 --port 8787
```

See [SPEC.md](../SPEC.md) and [SPEC-BUILD.md](../SPEC-BUILD.md) for the locked v0.1 target schema.
