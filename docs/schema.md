# Schema

AxiContext v0.1 uses schema version `"1.0.0"` for config, manifest, and graph-facing data.

## On-disk layout

After `axictx init` and `axictx sync`:

```text
PROJECT_CONTEXT.md
.axicontext/
  config.toml
  manifest.json
  graph/
    graph.sqlite
```

## Manifest

`.axicontext/manifest.json` records the generated baseline used by drift checks.

Current TypeScript shape:

```typescript
interface SyncManifest {
  schema_version: string;
  generated_at: string;
  project_root: string;
  content_hash: string;
  adapters: Record<
    string,
    {
      digest: string;
      warnings: string[];
      node_count: number;
      edge_count: number;
      metadata: Record<string, unknown>;
    }
  >;
  stats: {
    node_count: number;
    edge_count: number;
  };
}
```

The stable fields for external tooling are `schema_version`, `generated_at`, `content_hash`, `adapters`, and `stats`.

## SQLite graph

The graph lives at `.axicontext/graph/graph.sqlite`.

Current DDL:

```sql
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS excerpts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  provenance TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  id UNINDEXED,
  text
);
```

`data` and `provenance` are JSON strings. Consumers should use the SDK or Agent Read API instead of reading the database directly unless they are building tooling that needs raw graph access.

## Context slice

The graph slice response contains:

```typescript
interface GraphSlice {
  topic: string;
  depth: number;
  max_tokens: number;
  estimated_tokens: number;
  nodes: unknown[];
  edges: unknown[];
  excerpts: unknown[];
}
```

The API endpoint is:

```text
GET /v1/context/slice?topic=<topic>&depth=2&max_tokens=2000
```

## Query result

`axictx query --json` and `POST /v1/context/query` return:

```typescript
interface QueryResult {
  question: string;
  max_tokens: number;
  include: string[];
  answer_context: ContextExcerpt[];
  nodes: ContextNode[];
  manifest_version: string;
}
```

## Drift report

`axictx drift --format json` and `GET /v1/drift` return:

```typescript
interface DriftReport {
  status: "ok" | "drift";
  severity: "info" | "low" | "medium" | "high" | "critical";
  generated_at: string;
  changes: DriftChange[];
  summary: {
    total_changes: number;
    by_severity: Record<string, number>;
  };
}
```

## Generated Markdown

`PROJECT_CONTEXT.md` is the human-readable projection. The locked target in [SPEC-BUILD.md](../SPEC-BUILD.md) includes a generated banner:

```text
<!-- axi:generated managed-by=axictx schema=1.0.0 hash=sha256:... -->
```

Manual content should live inside the manual markers described by the spec when that generator behavior is present.
