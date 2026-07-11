export type DriftSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface ManifestAdapterEntry {
  digest?: string;
  stats?: Record<string, number | string | boolean>;
  direct?: string[];
  deps?: string[];
  paths?: string[];
}

export interface Manifest {
  schema_version: string;
  axictx_version?: string;
  generated_at?: string;
  project_root?: string;
  content_hash?: string;
  adapters: Record<string, ManifestAdapterEntry>;
  embedding_model?: string;
  policy_pack?: string;
  project_context_hash?: string;
  [key: string]: unknown;
}

export interface ContextExcerpt {
  id: string;
  path: string;
  source_type: "code" | "docs" | "manifest" | "unknown";
  text: string;
  tokens: number;
}

export interface ContextNode {
  id: string;
  type: "file" | "dependency" | "module" | "project";
  label: string;
  path?: string;
}

export interface ContextSummary {
  repo_path: string;
  generated_at: string;
  file_count: number;
  auth_path_count: number;
  direct_dependency_count: number;
  nodes: ContextNode[];
  excerpts: ContextExcerpt[];
  manifest: Manifest;
}

export interface ContextPage {
  summary: ContextSummary;
  page: {
    cursor: string | null;
    next_cursor: string | null;
    limit: number;
  };
}

export interface SliceRequest {
  topic: string;
  depth?: number;
  max_tokens?: number;
}

export interface QueryRequest {
  question: string;
  max_tokens?: number;
  include?: Array<"code" | "docs" | "issues" | "manifest">;
}

export interface QueryResult {
  question: string;
  max_tokens: number;
  include: string[];
  answer_context: ContextExcerpt[];
  nodes: ContextNode[];
  manifest_version: string;
}

export interface DriftChange {
  kind:
    | "manifest.missing"
    | "manifest.schema_mismatch"
    | "file_tree.digest_changed"
    | "readme.changed"
    | "dependency.added"
    | "dependency.digest_changed"
    | "auth_paths.changed";
  severity: DriftSeverity;
  detail: string;
  path?: string;
  before?: string;
  after?: string;
}

export interface DriftReport {
  status: "ok" | "drift";
  severity: DriftSeverity;
  generated_at: string;
  changes: DriftChange[];
  summary: {
    total_changes: number;
    by_severity: Record<DriftSeverity, number>;
  };
}

export interface ServeConfig {
  host: string;
  port: number;
  api_token?: string;
}

export interface AxiConfig {
  serve: ServeConfig;
  query: {
    max_tokens_default: number;
  };
}
