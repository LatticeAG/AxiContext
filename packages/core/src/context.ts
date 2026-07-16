import path from "node:path";
import { fileExists, listRepoFiles, safeReadText, sha256, estimateTokens } from "./fs-utils.js";
import { GraphStore } from "./graphStore.js";
import type { Excerpt, GraphSlice, Node } from "./graph-types.js";
import type {
  ContextExcerpt,
  ContextNode,
  ContextPage,
  ContextSummary,
  Manifest,
  SliceRequest
} from "./types.js";

interface RepoFacts {
  files: string[];
  file_tree_digest: string;
  readme_digest: string;
  direct_dependencies: string[];
  auth_paths: string[];
}

function buildManifestFromFacts(facts: RepoFacts): Manifest {
  return {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    content_hash: facts.file_tree_digest,
    adapters: {
      git: { digest: facts.file_tree_digest },
      readme: { digest: facts.readme_digest },
      dependencies: {
        digest: sha256(facts.direct_dependencies.join("\n")),
        direct: facts.direct_dependencies
      },
      auth_paths: {
        digest: sha256(facts.auth_paths.join("\n")),
        paths: facts.auth_paths
      }
    }
  };
}

export async function loadManifest(repoPath: string): Promise<Manifest | null> {
  const manifestPath = path.join(repoPath, ".axicontext", "manifest.json");
  if (!(await fileExists(manifestPath))) {
    return null;
  }
  const raw = await safeReadText(manifestPath);
  if (!raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function graphPath(repoPath: string): string {
  return path.join(repoPath, ".axicontext", "graph", "graph.sqlite");
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function graphNodeType(node: Node): ContextNode["type"] {
  if (node.type === "project" || node.type === "module" || node.type === "file" || node.type === "dependency") {
    return node.type;
  }
  return node.type === "tree_digest" ? "module" : "file";
}

function graphNodeLabel(node: Node): string {
  return readString(node.data, "name") ?? readString(node.data, "path") ?? readString(node.data, "label") ?? node.id;
}

function graphNodeToContextNode(node: Node): ContextNode {
  const pathValue = readString(node.data, "path");
  return {
    id: node.id,
    type: graphNodeType(node),
    label: graphNodeLabel(node),
    ...(pathValue ? { path: pathValue } : {})
  };
}

async function collectRepoFacts(repoPath: string): Promise<RepoFacts> {
  const files = await listRepoFiles(repoPath);
  const readmeCandidates = files.filter((p) => /^readme(\.|$)/i.test(path.basename(p)));
  const readmePath = readmeCandidates[0] ?? "README.md";
  const readmeContent = await safeReadText(path.join(repoPath, readmePath));

  const packageJsonPath = path.join(repoPath, "package.json");
  let directDependencies: string[] = [];
  if (await fileExists(packageJsonPath)) {
    const packageJsonRaw = await safeReadText(packageJsonPath);
    try {
      const parsed = JSON.parse(packageJsonRaw) as {
        dependencies?: Record<string, string>;
      };
      directDependencies = Object.keys(parsed.dependencies ?? {}).sort();
    } catch {
      directDependencies = [];
    }
  }

  const authRegex = /(auth|oauth|session|login|jwt|token|rbac|acl)/i;
  const authPaths = files.filter((file) => authRegex.test(file));
  const fileTreeDigest = sha256(files.join("\n"));

  return {
    files,
    file_tree_digest: fileTreeDigest,
    readme_digest: sha256(readmeContent),
    direct_dependencies: directDependencies,
    auth_paths: authPaths
  };
}

function buildNodes(facts: RepoFacts): ContextNode[] {
  const nodes: ContextNode[] = [
    {
      id: "project:root",
      type: "project",
      label: "Repository Root"
    }
  ];

  for (const dep of facts.direct_dependencies) {
    nodes.push({
      id: `dependency:${dep}`,
      type: "dependency",
      label: dep
    });
  }

  for (const file of facts.auth_paths.slice(0, 25)) {
    nodes.push({
      id: `file:${file}`,
      type: "file",
      label: path.basename(file),
      path: file
    });
  }

  return nodes;
}

async function buildExcerpts(repoPath: string, files: string[]): Promise<ContextExcerpt[]> {
  const candidateFiles = files.filter((file) => {
    const base = path.basename(file).toLowerCase();
    if (base === "readme.md" || base === "project_context.md") {
      return true;
    }
    return /(auth|oauth|session|login|jwt|token|docs\/|manifest\.json|package\.json)/i.test(file);
  });

  const excerpts: ContextExcerpt[] = [];
  for (const file of candidateFiles.slice(0, 50)) {
    const content = await safeReadText(path.join(repoPath, file));
    if (!content.trim()) {
      continue;
    }
    const text = content.split(/\r?\n/).slice(0, 30).join("\n").slice(0, 1200);
    let sourceType: ContextExcerpt["source_type"] = "code";
    if (file.toLowerCase().endsWith(".md")) {
      sourceType = "docs";
    } else if (file.includes("manifest")) {
      sourceType = "manifest";
    }

    excerpts.push({
      id: `excerpt:${file}`,
      path: file,
      source_type: sourceType,
      text,
      tokens: estimateTokens(text)
    });
  }

  return excerpts;
}

export async function getContextSummary(repoPath: string): Promise<ContextSummary> {
  const facts = await collectRepoFacts(repoPath);
  const manifest = (await loadManifest(repoPath)) ?? buildManifestFromFacts(facts);
  const excerpts = await buildExcerpts(repoPath, facts.files);

  return {
    repo_path: repoPath,
    generated_at: new Date().toISOString(),
    file_count: facts.files.length,
    auth_path_count: facts.auth_paths.length,
    direct_dependency_count: facts.direct_dependencies.length,
    nodes: buildNodes(facts),
    excerpts,
    manifest
  };
}

function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function getContextPage(
  repoPath: string,
  options?: { cursor?: string; limit?: number }
): Promise<ContextPage> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 200));
  const offset = parseCursor(options?.cursor);
  const manifest = (await loadManifest(repoPath)) ?? (await getContextSummary(repoPath)).manifest;

  if (await fileExists(graphPath(repoPath))) {
    const store = GraphStore.open(repoPath);
    try {
      const nodes = store.listNodes().map(graphNodeToContextNode);
      return {
        manifest,
        nodes: nodes.slice(offset, offset + limit),
        next_cursor: offset + limit < nodes.length ? String(offset + limit) : null
      };
    } finally {
      store.close();
    }
  }

  const summary = await getContextSummary(repoPath);
  const nodes = summary.nodes;
  return {
    manifest,
    nodes: nodes.slice(offset, offset + limit),
    next_cursor: offset + limit < nodes.length ? String(offset + limit) : null
  };
}

export async function getContextSlice(
  repoPath: string,
  request: SliceRequest
): Promise<GraphSlice & { manifest: Manifest }> {
  const depth = request.depth ?? 2;
  const maxTokens = Math.max(200, request.max_tokens ?? 2000);
  if (await fileExists(graphPath(repoPath))) {
    const manifest = (await loadManifest(repoPath)) ?? (await getContextSummary(repoPath)).manifest;
    const store = GraphStore.open(repoPath);
    try {
      return {
        ...store.getSlice(request.topic, depth, maxTokens),
        manifest
      };
    } finally {
      store.close();
    }
  }

  const summary = await getContextSummary(repoPath);
  const topic = request.topic.toLowerCase();
  const matching = summary.excerpts
    .filter((excerpt) => {
      return (
        excerpt.path.toLowerCase().includes(topic) ||
        excerpt.text.toLowerCase().includes(topic)
      );
    })
    .sort((a, b) => b.tokens - a.tokens);

  const selected: ContextExcerpt[] = [];
  let usedTokens = 0;
  for (const excerpt of matching) {
    if (usedTokens + excerpt.tokens > maxTokens) {
      continue;
    }
    usedTokens += excerpt.tokens;
    selected.push(excerpt);
  }

  const nodeSet = new Set(selected.map((excerpt) => excerpt.path));
  const nodes = summary.nodes
    .filter((node) => !node.path || nodeSet.has(node.path) || node.type !== "file")
    .map(contextNodeToGraphNode);
  const excerpts = selected.map(contextExcerptToGraphExcerpt);

  return {
    topic: request.topic,
    depth,
    max_tokens: maxTokens,
    estimated_tokens: estimateTokens(JSON.stringify({ nodes, excerpts })),
    excerpts,
    nodes,
    edges: [],
    manifest: summary.manifest
  };
}

function contextNodeToGraphNode(node: ContextNode): Node {
  const now = new Date().toISOString();
  return {
    id: node.id,
    type: node.type,
    data: {
      label: node.label,
      ...(node.path ? { path: node.path } : {})
    },
    created_at: now,
    updated_at: now
  };
}

function contextExcerptToGraphExcerpt(excerpt: ContextExcerpt): Excerpt {
  return {
    id: excerpt.id,
    text: excerpt.text,
    provenance: excerpt.provenance ?? {
      adapter: "summary",
      path: excerpt.path,
      start_line: excerpt.start_line,
      end_line: excerpt.end_line,
      ingested_at: new Date().toISOString()
    }
  };
}

export async function getManifest(repoPath: string): Promise<Manifest> {
  const summary = await getContextSummary(repoPath);
  return summary.manifest;
}
