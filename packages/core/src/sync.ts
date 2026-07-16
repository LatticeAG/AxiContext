import { writeFile } from "node:fs/promises";
import path from "node:path";

import { loadAxiContextConfig, resolveAxiRepoRoot } from "./config.js";
import type { AdapterManifestEntry } from "./graphStore.js";
import { GraphStore } from "./graphStore.js";
import type { Edge, Excerpt, Node, UpsertEdgeInput, UpsertNodeInput } from "./graph-types.js";
import { applyPolicy } from "./policy.js";
import { generateProjectContext } from "./project-context.js";
import type {
  AdapterResult,
  GraphEdge,
  GraphNode,
  ResolvedSyncConfig,
  SourceAdapter,
  SyncConfig,
  SyncManifest,
  SyncResult,
} from "./types.js";
import { resolveConfig, sha256, stableStringify } from "./utils.js";

interface CanonicalGraph {
  nodes: Node[];
  edges: Edge[];
  excerpts: Excerpt[];
}

function adapterStats(result: AdapterResult): Record<string, number | string | boolean> {
  const stats: Record<string, number | string | boolean> = {
    node_count: result.nodes.length,
    edge_count: result.edges.length,
  };
  for (const [key, value] of Object.entries(result.metadata)) {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      stats[key] = value;
    }
  }
  return stats;
}

function canonicalNodeId(node: GraphNode): string {
  if (node.type === "repo" && node.id.startsWith("repo:")) {
    return `project:${node.id.slice("repo:".length)}`;
  }
  if (node.type === "package_manifest" && node.id.startsWith("manifest:")) {
    return `module:${node.id.slice("manifest:".length)}`;
  }
  if (node.type === "lockfile" && node.id.startsWith("lockfile:")) {
    return `file:${node.id.slice("lockfile:".length)}`;
  }
  if (node.type === "tree_summary") {
    const summary = typeof node.attributes.summary === "string" ? node.attributes.summary : stableStringify(node.attributes);
    return `tree:${sha256(summary).slice("sha256:".length)}`;
  }
  return node.id;
}

function canonicalNodeType(node: GraphNode): UpsertNodeInput["type"] {
  switch (node.type) {
    case "repo":
      return "project";
    case "package_manifest":
      return "module";
    case "important_file":
    case "readme":
    case "lockfile":
      return "file";
    case "tree_summary":
      return "tree_digest";
    case "project":
    case "module":
    case "file":
    case "dependency":
    case "commit":
    case "tree_digest":
    case "issue":
    case "doc":
    case "decision":
    case "person":
      return node.type;
    default:
      return "file";
  }
}

function canonicalEdgeType(edge: GraphEdge): UpsertEdgeInput["type"] {
  switch (edge.type) {
    case "contains":
    case "depends_on":
    case "documents":
    case "tracked_by":
    case "decided_in":
    case "references":
    case "authored_by":
      return edge.type;
    default:
      return "references";
  }
}

function canonicalNodeData(node: GraphNode): Record<string, unknown> {
  const data = { ...node.attributes };
  delete data.excerpt;
  if (node.type === "repo" && typeof data.name !== "string") {
    data.name = node.id.slice("repo:".length);
  }
  if (node.type === "package_manifest") {
    data.role = "manifest";
  }
  if (node.type === "readme") {
    data.role = "readme";
  }
  if (node.type === "important_file") {
    data.role = "important";
  }
  if (node.type === "lockfile") {
    data.role = "lockfile";
  }
  if (node.type === "tree_summary") {
    const summary = typeof node.attributes.summary === "string" ? node.attributes.summary : stableStringify(node.attributes);
    data.digest = sha256(summary);
  }
  return data;
}

function nodeToExcerpt(adapterId: string, node: GraphNode, ingestedAt: string): Excerpt | null {
  const excerptText = node.attributes.excerpt;
  const excerptPath = node.attributes.path;
  if (typeof excerptText !== "string" || !excerptText.trim()) {
    return null;
  }
  return {
    id: sha256(`${excerptText}${stableStringify({ adapter: adapterId, path: excerptPath, ingested_at: ingestedAt })}`),
    text: excerptText,
    provenance: {
      adapter: adapterId,
      path: typeof excerptPath === "string" ? excerptPath : undefined,
      ingested_at: ingestedAt,
    },
  };
}

function canonicalizeAdapterResult(result: AdapterResult, ingestedAt: string): CanonicalGraph {
  const idMap = new Map<string, string>();
  const nodes: Node[] = [];
  const excerpts: Excerpt[] = [];

  for (const adapterNode of result.nodes) {
    const id = canonicalNodeId(adapterNode);
    idMap.set(adapterNode.id, id);
    const excerpt = nodeToExcerpt(result.adapterId, adapterNode, ingestedAt);
    const data = canonicalNodeData(adapterNode);
    if (excerpt) {
      data.excerpt_ids = [excerpt.id];
      excerpts.push(excerpt);
    }
    const now = ingestedAt;
    nodes.push({
      id,
      type: canonicalNodeType(adapterNode),
      data,
      created_at: now,
      updated_at: now,
    });
  }

  const edges: Edge[] = result.edges.map((adapterEdge) => {
    const fromId = idMap.get(adapterEdge.from) ?? adapterEdge.from;
    const toId = idMap.get(adapterEdge.to) ?? adapterEdge.to;
    const type = canonicalEdgeType(adapterEdge);
    const id = `edge:${sha256(`${fromId}|${type}|${toId}`).slice("sha256:".length)}`;
    return {
      id,
      from_id: fromId,
      to_id: toId,
      type,
      data: adapterEdge.attributes ?? {},
    };
  });

  return { nodes, edges, excerpts };
}

function mergeGraphs(graphs: CanonicalGraph[]): CanonicalGraph {
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const excerpts = new Map<string, Excerpt>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      nodes.set(node.id, node);
    }
    for (const edge of graph.edges) {
      edges.set(edge.id, edge);
    }
    for (const excerpt of graph.excerpts) {
      excerpts.set(excerpt.id, excerpt);
    }
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    excerpts: [...excerpts.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function resolveSyncConfig(config: SyncConfig, fileConfig: Awaited<ReturnType<typeof loadAxiContextConfig>>): ResolvedSyncConfig {
  return resolveConfig({
    maxChars: config.maxChars ?? fileConfig.project_context.max_chars,
    maxFiles: config.maxFiles ?? fileConfig.adapters.git.max_excerpt_files,
    maxLinesPerFile: config.maxLinesPerFile ?? fileConfig.adapters.git.max_lines_per_file,
    maxTreeDepth: config.maxTreeDepth ?? fileConfig.adapters.git.tree_max_depth,
    maxCommits: config.maxCommits ?? fileConfig.adapters.git.recent_commits,
    manifestPath: config.manifestPath ?? path.join(".axicontext", "manifest.json"),
    projectContextPath: config.projectContextPath ?? fileConfig.project_context.path,
    adapterIds: config.adapterIds,
  });
}

function selectAdapters(adapters: SourceAdapter[], requestedIds: string[] | undefined, gitEnabled: boolean): SourceAdapter[] {
  const requested = requestedIds ? new Set(requestedIds) : null;
  return adapters.filter((adapter) => {
    if (requested && !requested.has(adapter.id)) {
      return false;
    }
    if (adapter.id === "git") {
      return gitEnabled;
    }
    return true;
  });
}

export async function runSync(repoRoot: string = resolveAxiRepoRoot(), config: SyncConfig = {}): Promise<SyncResult> {
  const resolvedRoot = resolveAxiRepoRoot(repoRoot);
  const fileConfig = await loadAxiContextConfig(resolvedRoot);
  const resolvedConfig = resolveSyncConfig(config, fileConfig);
  const adapters = selectAdapters(config.adapters ?? [], resolvedConfig.adapterIds, fileConfig.adapters.git.enabled);
  const adapterManifest: Record<string, AdapterManifestEntry> = {};
  const warnings: string[] = [];
  const graphs: CanonicalGraph[] = [];
  const now = new Date().toISOString();

  const repoName = fileConfig.project.name || path.basename(resolvedRoot);
  const repoNode: Node = {
    id: `project:${repoName}`,
    type: "project",
    data: {
      name: repoName,
      root: resolvedRoot,
      default_branch: fileConfig.project.default_branch,
    },
    created_at: now,
    updated_at: now,
  };
  graphs.push({ nodes: [repoNode], edges: [], excerpts: [] });

  for (const adapter of adapters) {
    const shouldRun = await adapter.detect({ repoRoot: resolvedRoot });
    if (!shouldRun) {
      continue;
    }

    const ingestedAt = new Date().toISOString();
    const result = await adapter.ingest({ repoRoot: resolvedRoot, config: resolvedConfig });
    graphs.push(canonicalizeAdapterResult(result, ingestedAt));
    warnings.push(...result.warnings);
    adapterManifest[adapter.id] = {
      digest: result.digest,
      ingested_at: ingestedAt,
      warnings: result.warnings,
      stats: adapterStats(result),
    };
  }

  const graph = mergeGraphs(graphs);
  const policyResult = applyPolicy(graph, fileConfig.policy);
  if (policyResult.denied_paths.length > 0) {
    warnings.push(`Policy denied ${policyResult.denied_paths.length} path(s).`);
  }
  if (policyResult.redactions.length > 0) {
    warnings.push(`Policy redacted ${policyResult.redactions.reduce((sum, entry) => sum + entry.count, 0)} secret(s).`);
  }

  const store = GraphStore.open(resolvedRoot);
  try {
    store.clear();
    for (const node of policyResult.nodes) {
      store.upsertNode(node);
    }
    for (const edge of policyResult.edges) {
      store.upsertEdge(edge);
    }
    for (const excerpt of policyResult.excerpts) {
      store.addExcerpt(excerpt);
    }

    const initialManifest = store.exportManifest(adapterManifest);
    const projectContext = generateProjectContext({
      repoRoot: resolvedRoot,
      nodes: policyResult.nodes,
      edges: policyResult.edges,
      excerpts: policyResult.excerpts,
      manifest: initialManifest,
      config: resolvedConfig,
    });
    const projectContextHash = sha256(projectContext);
    const manifest = (
      config.dryRun
        ? store.exportManifest(adapterManifest, projectContextHash)
        : store.writeManifest(adapterManifest, projectContextHash)
    ) as SyncManifest;
    const finalProjectContext = generateProjectContext({
      repoRoot: resolvedRoot,
      nodes: policyResult.nodes,
      edges: policyResult.edges,
      excerpts: policyResult.excerpts,
      manifest,
      config: resolvedConfig,
      existingContent: projectContext,
    });

    const projectContextPath = path.join(resolvedRoot, resolvedConfig.projectContextPath);
    if (!config.dryRun) {
      await writeFile(projectContextPath, finalProjectContext, "utf8");
    }

    return {
      manifestPath: store.manifestPath,
      projectContextPath,
      manifest,
      projectContext: finalProjectContext,
      warnings,
    };
  } finally {
    store.close();
  }
}
