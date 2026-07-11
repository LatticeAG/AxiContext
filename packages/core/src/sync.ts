import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { GitSourceAdapter } from "@latticeag/axicontext-adapter-git";

import { GraphStore } from "./graph-store.js";
import { generateProjectContext } from "./project-context.js";
import type { SourceAdapter, SyncConfig, SyncManifest, SyncResult } from "./types.js";
import { resolveConfig, sha256, stableStringify } from "./utils.js";

export async function runSync(repoRoot: string, config: SyncConfig = {}): Promise<SyncResult> {
  const resolvedConfig = resolveConfig(config);
  const adapters = loadAdapters(resolvedConfig.adapterIds);
  const graphStore = new GraphStore();
  const adapterManifest: SyncManifest["adapters"] = {};
  const warnings: string[] = [];

  const repoNodeId = `repo:${path.basename(repoRoot)}`;
  graphStore.addNodes([
    {
      id: repoNodeId,
      type: "repo",
      attributes: {
        name: path.basename(repoRoot),
        root: repoRoot,
      },
    },
  ]);

  for (const adapter of adapters) {
    const shouldRun = await adapter.detect({ repoRoot });
    if (!shouldRun) {
      continue;
    }

    const result = await adapter.ingest({ repoRoot, config: resolvedConfig });
    graphStore.addNodes(result.nodes);
    graphStore.addEdges(result.edges);
    warnings.push(...result.warnings);

    adapterManifest[adapter.id] = {
      digest: result.digest,
      warnings: result.warnings,
      node_count: result.nodes.length,
      edge_count: result.edges.length,
      metadata: result.metadata,
    };
  }

  const nodes = graphStore.getNodes();
  const edges = graphStore.getEdges();
  const contentHash = sha256(
    stableStringify({
      adapters: adapterManifest,
      nodes,
      edges,
    })
  );

  const manifest: SyncManifest = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    project_root: repoRoot,
    content_hash: contentHash,
    adapters: adapterManifest,
    stats: {
      node_count: nodes.length,
      edge_count: edges.length,
    },
  };

  const manifestPath = path.join(repoRoot, resolvedConfig.manifestPath);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const projectContext = generateProjectContext({
    repoRoot,
    nodes,
    manifest,
    config: resolvedConfig,
  });
  const projectContextPath = path.join(repoRoot, resolvedConfig.projectContextPath);
  await writeFile(projectContextPath, projectContext, "utf8");

  return {
    manifestPath,
    projectContextPath,
    manifest,
    projectContext,
    warnings,
  };
}

function loadAdapters(adapterIds?: string[]): SourceAdapter[] {
  const allAdapters: SourceAdapter[] = [new GitSourceAdapter()];
  if (!adapterIds || adapterIds.length === 0) {
    return allAdapters;
  }

  const requested = new Set(adapterIds);
  return allAdapters.filter((adapter) => requested.has(adapter.id));
}
