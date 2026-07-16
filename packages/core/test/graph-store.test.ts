import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GraphStore } from "../src/graphStore.js";
import { computeContentHash, stableStringify } from "../src/hash.js";
import { exportJsonSchemas } from "../src/graph-types.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "axicontext-graph-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("GraphStore", () => {
  it("creates .axicontext/graph/graph.sqlite on open", () => {
    const repoRoot = makeTempRoot();
    const store = GraphStore.open(repoRoot);

    expect(store.graphPath).toBe(join(repoRoot, ".axicontext", "graph", "graph.sqlite"));
    expect(existsSync(store.graphPath)).toBe(true);

    store.close();
  });

  it("upserts nodes and edges and fetches nodes", () => {
    const repoRoot = makeTempRoot();
    const store = GraphStore.open(repoRoot);

    store.upsertNode({
      id: "project:root",
      type: "project",
      data: { name: "AxiContext" },
    });
    store.upsertNode({
      id: "module:auth",
      type: "module",
      data: { path: "src/auth" },
    });
    store.upsertEdge({
      id: "edge:project-module",
      from_id: "project:root",
      to_id: "module:auth",
      type: "contains",
      data: {},
    });

    const node = store.getNode("module:auth");
    expect(node?.type).toBe("module");
    expect(node?.data).toEqual({ path: "src/auth" });

    store.close();
  });

  it("adds excerpts with content-hash IDs and supports FTS search", () => {
    const repoRoot = makeTempRoot();
    const store = GraphStore.open(repoRoot);

    const excerpt = store.addExcerpt({
      text: "OAuth providers are configured in src/auth/providers.ts",
      provenance: {
        adapter: "git",
        path: "src/auth/providers.ts",
        start_line: 1,
        end_line: 10,
        commit: "abc123",
        url: "https://example.com/repo/blob/abc123/src/auth/providers.ts#L1-L10",
        ingested_at: new Date().toISOString(),
      },
    });

    expect(excerpt.id).toBe(computeContentHash(`${excerpt.text}${stableStringify(excerpt.provenance)}`));
    const results = store.searchExcerpts("OAuth providers", 10);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(excerpt.id);

    store.close();
  });

  it("returns BFS slices with token budgeting", () => {
    const repoRoot = makeTempRoot();
    const store = GraphStore.open(repoRoot);

    store.upsertNode({
      id: "project:root",
      type: "project",
      data: { topic: "auth" },
    });
    store.upsertNode({
      id: "module:auth",
      type: "module",
      data: { topic: "auth" },
    });
    store.upsertNode({
      id: "file:src/auth/oauth.ts",
      type: "file",
      data: { topic: "auth" },
    });
    store.upsertEdge({
      id: "edge:a",
      from_id: "project:root",
      to_id: "module:auth",
      type: "contains",
      data: {},
    });
    store.upsertEdge({
      id: "edge:b",
      from_id: "module:auth",
      to_id: "file:src/auth/oauth.ts",
      type: "contains",
      data: {},
    });
    store.addExcerpt({
      text: "Auth module contains OAuth provider configuration.",
      provenance: {
        adapter: "git",
        path: "src/auth/oauth.ts",
        ingested_at: new Date().toISOString(),
      },
    });

    const slice = store.getSlice("auth", 2, 1000);
    expect(slice.topic).toBe("auth");
    expect(slice.nodes.map((node) => node.id)).toEqual([
      "file:src/auth/oauth.ts",
      "module:auth",
      "project:root",
    ]);
    expect(slice.edges.map((edge) => edge.id)).toEqual(["edge:a", "edge:b"]);
    expect(slice.excerpts.length).toBeGreaterThan(0);

    store.close();
  });

  it("computes graph hash and writes manifest", () => {
    const repoRoot = makeTempRoot();
    const store = GraphStore.open(repoRoot);

    store.upsertNode({
      id: "project:root",
      type: "project",
      data: { name: "AxiContext" },
    });
    store.upsertEdge({
      id: "edge:self",
      from_id: "project:root",
      to_id: "project:root",
      type: "references",
      data: {},
    });
    store.addExcerpt({
      text: "Manifest should be written under .axicontext/manifest.json",
      provenance: {
        adapter: "git",
        path: "README.md",
        ingested_at: new Date().toISOString(),
      },
    });

    const hashA = store.computeContentHash();
    const hashB = store.computeContentHash();
    expect(hashA).toBe(hashB);

    const manifest = store.writeManifest({
      git: {
        digest: "sha256:adapter",
        stats: { files_considered: 1 },
      },
    });
    expect(manifest.axictx_version).toBe("0.1.0");
    expect(manifest.embedding_model).toBe("none");
    expect(manifest.adapters.git.digest).toBe("sha256:adapter");
    expect(manifest.stats.node_count).toBe(1);
    expect(manifest.stats.edge_count).toBe(1);
    expect(manifest.stats.excerpt_count).toBe(1);
    expect(existsSync(join(repoRoot, ".axicontext", "manifest.json"))).toBe(true);

    const persisted = JSON.parse(
      readFileSync(join(repoRoot, ".axicontext", "manifest.json"), "utf8"),
    ) as { content_hash: string };
    expect(persisted.content_hash).toBe(manifest.content_hash);

    store.close();
  });

  it("computes content hash from graph IDs only", () => {
    const repoRoot = makeTempRoot();
    const store = GraphStore.open(repoRoot);

    store.upsertNode({
      id: "project:root",
      type: "project",
      data: { name: "first" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const hashA = store.computeContentHash();
    store.upsertNode({
      id: "project:root",
      type: "project",
      data: { name: "second" },
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    const hashB = store.computeContentHash();

    expect(hashA).toBe(hashB);
    store.close();
  });
});

describe("exportJsonSchemas", () => {
  it("exports JSON Schema for graph data shapes", () => {
    const schemas = exportJsonSchemas();
    expect(schemas.node).toBeTruthy();
    expect(schemas.edge).toBeTruthy();
    expect(schemas.graphManifest).toBeTruthy();
  });
});
