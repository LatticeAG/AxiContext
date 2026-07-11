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
