import { existsSync } from "node:fs";
import path from "node:path";
import { GitSourceAdapter } from "@latticeag/axicontext-adapter-git";
import {
  detectDrift,
  getManifest as getRepoManifest,
  GraphStore,
  queryContext,
  resolveAxiRepoRoot,
  runSync,
  type ContextExcerpt,
  type ContextNode,
  type DriftReport,
  type Edge,
  type Excerpt,
  type GraphSlice,
  type Manifest,
  type Node,
  type QueryResult,
  type SyncConfig,
  type SyncResult,
} from "@latticeag/axicontext-core";

export {
  AxiContextCoreClient as AxiContextClient,
  type CoreClientOptions as AxiContextClientOptions,
} from "@latticeag/axicontext-core";

export * from "@latticeag/axicontext-core";
export { GitSourceAdapter } from "@latticeag/axicontext-adapter-git";

export type SyncOptions = SyncConfig;

interface LocalMode {
  kind: "local";
  repoRoot: string;
}

interface RemoteMode {
  kind: "remote";
  baseUrl: string;
  token?: string;
}

type ContextMode = LocalMode | RemoteMode;

interface LegacySlice {
  topic: string;
  depth: number;
  max_tokens: number;
  excerpts: ContextExcerpt[];
  nodes: ContextNode[];
}

const NODE_TYPES: ReadonlySet<string> = new Set([
  "project",
  "module",
  "file",
  "dependency",
  "commit",
  "tree_digest",
  "issue",
  "doc",
  "decision",
  "person",
]);

const EDGE_TYPES: ReadonlySet<string> = new Set([
  "contains",
  "depends_on",
  "documents",
  "tracked_by",
  "decided_in",
  "references",
  "authored_by",
]);

const SOURCE_TYPES: ReadonlySet<string> = new Set(["code", "docs", "manifest", "unknown"]);
const DRIFT_STATUSES: ReadonlySet<string> = new Set(["ok", "drift"]);

function normalizeBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return parsed.toString().replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeType(value: unknown): value is Node["type"] {
  return typeof value === "string" && NODE_TYPES.has(value);
}

function isEdgeType(value: unknown): value is Edge["type"] {
  return typeof value === "string" && EDGE_TYPES.has(value);
}

function isContextNodeType(value: unknown): value is ContextNode["type"] {
  return value === "file" || value === "dependency" || value === "module" || value === "project";
}

function isSourceType(value: unknown): value is ContextExcerpt["source_type"] {
  return typeof value === "string" && SOURCE_TYPES.has(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isManifest(value: unknown): value is Manifest {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.schema_version === "string" && isRecord(value.adapters);
}

function isProvenance(value: unknown): value is Excerpt["provenance"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.adapter === "string" &&
    typeof value.ingested_at === "string" &&
    optionalString(value.path) &&
    optionalNumber(value.start_line) &&
    optionalNumber(value.end_line) &&
    optionalString(value.commit) &&
    optionalString(value.url)
  );
}

function isGraphNode(value: unknown): value is Node {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isNodeType(value.type) &&
    isRecord(value.data) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function isGraphEdge(value: unknown): value is Edge {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.from_id === "string" &&
    typeof value.to_id === "string" &&
    isEdgeType(value.type) &&
    isRecord(value.data)
  );
}

function isGraphExcerpt(value: unknown): value is Excerpt {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "string" && typeof value.text === "string" && isProvenance(value.provenance);
}

function isGraphSlice(value: unknown): value is GraphSlice {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.topic === "string" &&
    typeof value.depth === "number" &&
    typeof value.max_tokens === "number" &&
    typeof value.estimated_tokens === "number" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isGraphNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isGraphEdge) &&
    Array.isArray(value.excerpts) &&
    value.excerpts.every(isGraphExcerpt)
  );
}

function isContextNode(value: unknown): value is ContextNode {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isContextNodeType(value.type) &&
    typeof value.label === "string" &&
    optionalString(value.path)
  );
}

function isContextExcerpt(value: unknown): value is ContextExcerpt {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    isSourceType(value.source_type) &&
    typeof value.text === "string" &&
    typeof value.tokens === "number"
  );
}

function isLegacySlice(value: unknown): value is LegacySlice {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.topic === "string" &&
    typeof value.depth === "number" &&
    typeof value.max_tokens === "number" &&
    Array.isArray(value.excerpts) &&
    value.excerpts.every(isContextExcerpt) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isContextNode)
  );
}

function isQueryResult(value: unknown): value is QueryResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.question === "string" &&
    Array.isArray(value.answer_context) &&
    value.answer_context.every(isContextExcerpt) &&
    typeof value.tokens_used === "number" &&
    typeof value.manifest_version === "string" &&
    optionalString(value.warning) &&
    optionalString(value.hint)
  );
}

function isDriftReport(value: unknown): value is DriftReport {
  if (!isRecord(value) || !isRecord(value.summary)) {
    return false;
  }

  return (
    typeof value.status === "string" &&
    DRIFT_STATUSES.has(value.status) &&
    typeof value.severity === "string" &&
    typeof value.generated_at === "string" &&
    Array.isArray(value.changes) &&
    typeof value.summary.total_changes === "number" &&
    isRecord(value.summary.by_severity)
  );
}

function requireResponse<T>(value: unknown, guard: (candidate: unknown) => candidate is T, label: string): T {
  if (guard(value)) {
    return value;
  }

  throw new TypeError(`Invalid ${label} response from AxiContext Agent Read API.`);
}

function contextNodeTypeToGraphType(type: ContextNode["type"]): Node["type"] {
  switch (type) {
    case "file":
    case "dependency":
    case "module":
    case "project":
      return type;
  }
}

function legacySliceToGraphSlice(slice: LegacySlice): GraphSlice {
  const now = new Date().toISOString();
  const nodes: Node[] = slice.nodes.map((node) => ({
    id: node.id,
    type: contextNodeTypeToGraphType(node.type),
    data: {
      label: node.label,
      ...(node.path ? { path: node.path } : {}),
    },
    created_at: now,
    updated_at: now,
  }));
  const excerpts: Excerpt[] = slice.excerpts.map((excerpt) => ({
    id: excerpt.id,
    text: excerpt.text,
    provenance: {
      adapter: "agent-read-api",
      path: excerpt.path,
      ingested_at: now,
    },
  }));

  return {
    topic: slice.topic,
    depth: Math.max(0, Math.trunc(slice.depth)),
    max_tokens: Math.max(1, Math.trunc(slice.max_tokens)),
    estimated_tokens: Math.max(0, Math.ceil(JSON.stringify({ nodes, excerpts }).length / 4)),
    nodes,
    edges: [],
    excerpts,
  };
}

function encodeOptionalNumber(params: URLSearchParams, key: string, value: number | undefined): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

function ensureLocalRepoSynced(repoRoot: string): void {
  const graphPath = path.join(repoRoot, ".axicontext", "graph", "graph.sqlite");
  const manifestPath = path.join(repoRoot, ".axicontext", "manifest.json");
  if (!existsSync(graphPath) || !existsSync(manifestPath)) {
    throw new Error("AxiContext repository is not synced. Run axictx sync before requesting a context slice.");
  }
}

export class AxiContext {
  private constructor(private readonly mode: ContextMode) {}

  static async fromRepo(repoRoot?: string): Promise<AxiContext> {
    return new AxiContext({
      kind: "local",
      repoRoot: resolveAxiRepoRoot(repoRoot),
    });
  }

  static async connect(opts: { baseUrl: string; token?: string }): Promise<AxiContext> {
    return new AxiContext({
      kind: "remote",
      baseUrl: normalizeBaseUrl(opts.baseUrl),
      token: opts.token,
    });
  }

  async sync(opts: SyncOptions = {}): Promise<SyncResult> {
    if (this.mode.kind !== "local") {
      throw new Error("sync is only available for repository-backed AxiContext instances.");
    }

    return runSync(this.mode.repoRoot, {
      ...opts,
      adapters: opts.adapters ?? [new GitSourceAdapter()],
    });
  }

  async getManifest(): Promise<Manifest> {
    if (this.mode.kind === "local") {
      return getRepoManifest(this.mode.repoRoot);
    }

    const value = await this.fetchJson("/v1/manifest");
    return requireResponse(value, isManifest, "manifest");
  }

  async slice(opts: { topic: string; depth?: number; maxTokens?: number }): Promise<GraphSlice> {
    if (this.mode.kind === "local") {
      ensureLocalRepoSynced(this.mode.repoRoot);
      const store = GraphStore.open(this.mode.repoRoot);
      try {
        return store.getSlice(opts.topic, opts.depth, opts.maxTokens);
      } finally {
        store.close();
      }
    }

    const params = new URLSearchParams({ topic: opts.topic });
    encodeOptionalNumber(params, "depth", opts.depth);
    encodeOptionalNumber(params, "max_tokens", opts.maxTokens);

    const value = await this.fetchJson(`/v1/context/slice?${params.toString()}`);
    if (isGraphSlice(value)) {
      return value;
    }
    if (isLegacySlice(value)) {
      return legacySliceToGraphSlice(value);
    }

    throw new TypeError("Invalid context slice response from AxiContext Agent Read API.");
  }

  async query(opts: { question: string; maxTokens?: number }): Promise<QueryResult> {
    if (this.mode.kind === "local") {
      return queryContext(this.mode.repoRoot, {
        question: opts.question,
        max_tokens: opts.maxTokens,
      });
    }

    const value = await this.fetchJson("/v1/context/query", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        question: opts.question,
        max_tokens: opts.maxTokens,
      }),
    });
    return requireResponse(value, isQueryResult, "query");
  }

  async drift(): Promise<DriftReport> {
    if (this.mode.kind === "local") {
      return detectDrift(this.mode.repoRoot);
    }

    const value = await this.fetchJson("/v1/drift");
    return requireResponse(value, isDriftReport, "drift");
  }

  private async fetchJson(path: string, init: RequestInit = {}): Promise<unknown> {
    if (this.mode.kind !== "remote") {
      throw new Error("fetchJson is only available for connected AxiContext instances.");
    }

    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (this.mode.token) {
      headers.set("authorization", `Bearer ${this.mode.token}`);
    }

    const response = await fetch(`${this.mode.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`AxiContext Agent Read API ${response.status}: ${detail || response.statusText}`);
    }

    const value: unknown = await response.json();
    return value;
  }
}
