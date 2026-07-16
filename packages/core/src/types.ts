export type DriftSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface ManifestAdapterEntry {
  digest?: string;
  ingested_at?: string;
  stats?: Record<string, number | string | boolean>;
  warnings?: string[];
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
  stats?: {
    node_count: number;
    edge_count: number;
    excerpt_count?: number;
  };
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
    embeddings: "off" | "auto";
  };
  repo_root: string;
  config_path: string;
  github_token?: string;
  ci: boolean;
}

export type RepositoryType = "node" | "python" | "rust" | "go" | "mixed" | "unknown";

export type DriftFailSeverity = "low" | "medium" | "high" | "critical";
export type Ecosystem = Exclude<RepositoryType, "mixed" | "unknown">;

export interface AxiContextConfig {
  schema_version: "1.0.0";
  project: {
    name: string;
    default_branch: string;
  };
  project_context: {
    path: string;
    commit: boolean;
    max_chars: number;
    llm_polish: false;
  };
  serve: {
    host: string;
    port: number;
    api_token: string;
  };
  drift: {
    fail_on: DriftFailSeverity[];
    ignore_paths: string[];
  };
  adapters: {
    git: {
      enabled: boolean;
      important_path_globs: string[];
      recent_commits: number;
      max_excerpt_files: number;
      max_lines_per_file: number;
      tree_max_depth: number;
    };
    github_issues: {
      enabled: boolean;
      state: "open" | "closed" | "all";
      max_issues: number;
      label_include: string[];
      label_exclude: string[];
    };
  };
  query: {
    max_tokens_default: number;
    embeddings: "off" | "auto";
  };
  policy: {
    denylist_globs: string[];
    redact_patterns: string[];
  };
}

export interface InitResult {
  repositoryType: RepositoryType;
  ecosystems: Ecosystem[];
  mixed: boolean;
  configPath: string;
  createdAxiContextDir: boolean;
  createdConfig: boolean;
  createdProjectContext: boolean;
  missingGitignoreEntries: string[];
}

// --- Sync / adapter types (OSS graph pipeline) ---

export interface GraphNode {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  attributes?: Record<string, unknown>;
}

export interface RepoContext {
  repoRoot: string;
}

export interface ResolvedSyncConfig {
  maxChars: number;
  maxFiles: number;
  maxLinesPerFile: number;
  maxTreeDepth: number;
  maxCommits: number;
  manifestPath: string;
  projectContextPath: string;
  adapterIds?: string[];
}

export type SyncConfig = Partial<ResolvedSyncConfig> & {
  adapters?: SourceAdapter[];
  dryRun?: boolean;
};

export interface IngestContext extends RepoContext {
  config: ResolvedSyncConfig;
}

export interface AdapterResult {
  adapterId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  digest: string;
  warnings: string[];
  metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  readonly id: string;
  detect(ctx: RepoContext): Promise<boolean>;
  ingest(ctx: IngestContext): Promise<AdapterResult>;
}

export interface SyncManifest {
  schema_version: "1.0.0";
  axictx_version: string;
  generated_at: string;
  project_root: string;
  content_hash: string;
  project_context_hash: string;
  embedding_model: "none";
  policy_pack: string;
  adapters: Record<
    string,
    {
      digest: string;
      ingested_at: string;
      warnings: string[];
      stats: Record<string, number | string | boolean>;
    }
  >;
  stats: {
    node_count: number;
    edge_count: number;
    excerpt_count: number;
  };
}

export interface SyncResult {
  manifestPath: string;
  projectContextPath: string;
  manifest: SyncManifest;
  projectContext: string;
  warnings: string[];
}
