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

export type RepositoryType = "node" | "python" | "rust" | "go" | "unknown";

export interface AxiContextConfig {
  schema_version: string;
  project: {
    name: string;
    default_branch: string;
  };
  project_context: {
    path: string;
    commit: boolean;
    max_chars: number;
  };
  serve: {
    host: string;
    port: number;
  };
  drift: {
    fail_on: Array<"low" | "medium" | "high" | "critical">;
  };
  adapters: {
    git: {
      enabled: boolean;
    };
    github_issues: {
      enabled: boolean;
    };
  };
}

export interface InitResult {
  repositoryType: RepositoryType;
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

export type SyncConfig = Partial<ResolvedSyncConfig>;

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

export interface SyncResult {
  manifestPath: string;
  projectContextPath: string;
  manifest: SyncManifest;
  projectContext: string;
  warnings: string[];
}
