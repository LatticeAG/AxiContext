import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import { computeContentHash } from "./hash.js";
import { GRAPH_SCHEMA_DDL } from "./schema.js";
import {
  AddExcerptInput,
  AddExcerptInputSchema,
  Edge,
  EdgeSchema,
  Excerpt,
  ExcerptSchema,
  GraphManifest,
  GraphManifestSchema,
  GraphSlice,
  Node,
  NodeSchema,
  UpsertEdgeInput,
  UpsertEdgeInputSchema,
  UpsertNodeInput,
  UpsertNodeInputSchema,
} from "./graph-types.js";

type NodeRow = {
  id: string;
  type: string;
  data: string;
  created_at: string;
  updated_at: string;
};

type EdgeRow = {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  data: string;
};

type ExcerptRow = {
  id: string;
  text: string;
  provenance: string;
};

function parseNodeRow(row: NodeRow): Node {
  return NodeSchema.parse({ ...row, data: JSON.parse(row.data) });
}

function parseEdgeRow(row: EdgeRow): Edge {
  return EdgeSchema.parse({ ...row, data: JSON.parse(row.data) });
}

function parseExcerptRow(row: ExcerptRow): Excerpt {
  return ExcerptSchema.parse({ ...row, provenance: JSON.parse(row.provenance) });
}

function normalizeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" ");
}

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

export class GraphStore {
  private readonly db: Database.Database;
  readonly repoRoot: string;
  readonly graphPath: string;
  readonly manifestPath: string;

  private constructor(repoRoot: string, db: Database.Database) {
    this.repoRoot = resolve(repoRoot);
    this.db = db;
    this.graphPath = join(this.repoRoot, ".axicontext", "graph", "graph.sqlite");
    this.manifestPath = join(this.repoRoot, ".axicontext", "manifest.json");
  }

  static open(repoRoot: string): GraphStore {
    const root = resolve(repoRoot);
    const graphDir = join(root, ".axicontext", "graph");
    mkdirSync(graphDir, { recursive: true });

    const db = new Database(join(graphDir, "graph.sqlite"));
    db.pragma("journal_mode = WAL");
    db.exec(GRAPH_SCHEMA_DDL);

    return new GraphStore(root, db);
  }

  close(): void {
    this.db.close();
  }

  upsertNode(input: UpsertNodeInput): Node {
    const parsed = UpsertNodeInputSchema.parse(input);
    const now = new Date().toISOString();
    const createdAt = parsed.created_at ?? now;
    const updatedAt = parsed.updated_at ?? now;

    this.db
      .prepare(
        `
        INSERT INTO nodes (id, type, data, created_at, updated_at)
        VALUES (@id, @type, @data, @created_at, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          data = excluded.data,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        id: parsed.id,
        type: parsed.type,
        data: JSON.stringify(parsed.data),
        created_at: createdAt,
        updated_at: updatedAt,
      });

    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(parsed.id) as
      | NodeRow
      | undefined;
    if (!row) {
      throw new Error(`Failed to upsert node ${parsed.id}`);
    }
    return parseNodeRow(row);
  }

  upsertEdge(input: UpsertEdgeInput): Edge {
    const parsed = UpsertEdgeInputSchema.parse(input);
    this.db
      .prepare(
        `
        INSERT INTO edges (id, from_id, to_id, type, data)
        VALUES (@id, @from_id, @to_id, @type, @data)
        ON CONFLICT(id) DO UPDATE SET
          from_id = excluded.from_id,
          to_id = excluded.to_id,
          type = excluded.type,
          data = excluded.data
      `,
      )
      .run({
        id: parsed.id,
        from_id: parsed.from_id,
        to_id: parsed.to_id,
        type: parsed.type,
        data: JSON.stringify(parsed.data),
      });

    const row = this.db.prepare("SELECT * FROM edges WHERE id = ?").get(parsed.id) as
      | EdgeRow
      | undefined;
    if (!row) {
      throw new Error(`Failed to upsert edge ${parsed.id}`);
    }
    return parseEdgeRow(row);
  }

  addExcerpt(input: AddExcerptInput): Excerpt {
    const parsed = AddExcerptInputSchema.parse(input);
    const id = parsed.id ?? computeContentHash(parsed.text);

    this.db
      .prepare(
        `
        INSERT INTO excerpts (id, text, provenance)
        VALUES (@id, @text, @provenance)
        ON CONFLICT(id) DO UPDATE SET
          text = excluded.text,
          provenance = excluded.provenance
      `,
      )
      .run({
        id,
        text: parsed.text,
        provenance: JSON.stringify(parsed.provenance),
      });

    this.db.prepare("DELETE FROM fts WHERE id = ?").run(id);
    this.db.prepare("INSERT INTO fts (id, text) VALUES (?, ?)").run(id, parsed.text);

    const row = this.db.prepare("SELECT * FROM excerpts WHERE id = ?").get(id) as
      | ExcerptRow
      | undefined;
    if (!row) {
      throw new Error(`Failed to upsert excerpt ${id}`);
    }
    return parseExcerptRow(row);
  }

  getNode(id: string): Node | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
    return row ? parseNodeRow(row) : null;
  }

  searchExcerpts(query: string, limit = 10): Excerpt[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
        SELECT excerpts.id, excerpts.text, excerpts.provenance
        FROM fts
        JOIN excerpts ON excerpts.id = fts.id
        WHERE fts MATCH ?
        LIMIT ?
      `,
      )
      .all(normalizeFtsQuery(trimmed), Math.max(1, Math.min(limit, 100))) as ExcerptRow[];

    return rows.map(parseExcerptRow);
  }

  getSlice(topic: string, depth = 1, maxTokens = 4000): GraphSlice {
    const normalizedTopic = topic.trim();
    const normalizedDepth = Math.max(0, depth);
    const tokenBudget = Math.max(1, maxTokens);
    const like = `%${normalizedTopic}%`;

    const seedRows = this.db
      .prepare(
        `
        SELECT * FROM nodes
        WHERE id LIKE ? OR type LIKE ? OR data LIKE ?
        ORDER BY updated_at DESC
        LIMIT 25
      `,
      )
      .all(like, like, like) as NodeRow[];

    const visited = new Set(seedRows.map((row) => row.id));
    let frontier = new Set(visited);
    const edgesById = new Map<string, Edge>();

    for (let level = 0; level < normalizedDepth; level += 1) {
      if (frontier.size === 0) {
        break;
      }

      const next = new Set<string>();
      for (const nodeId of frontier) {
        const edgeRows = this.db
          .prepare("SELECT * FROM edges WHERE from_id = ? OR to_id = ?")
          .all(nodeId, nodeId) as EdgeRow[];

        for (const edgeRow of edgeRows) {
          if (!edgesById.has(edgeRow.id)) {
            edgesById.set(edgeRow.id, parseEdgeRow(edgeRow));
          }

          const neighbor = edgeRow.from_id === nodeId ? edgeRow.to_id : edgeRow.from_id;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.add(neighbor);
          }
        }
      }
      frontier = next;
    }

    const nodes = Array.from(visited)
      .map((id) => this.getNode(id))
      .filter((node): node is Node => node !== null)
      .sort((a, b) => a.id.localeCompare(b.id));

    const edges = Array.from(edgesById.values()).sort((a, b) => a.id.localeCompare(b.id));
    const excerpts = normalizedTopic ? this.searchExcerpts(normalizedTopic, 25) : [];

    const selectedNodes: Node[] = [];
    const selectedNodeIds = new Set<string>();
    let estimatedTokens = 0;

    for (const node of nodes) {
      const nodeTokens = estimateTokens(node);
      if (estimatedTokens + nodeTokens > tokenBudget) {
        break;
      }
      selectedNodes.push(node);
      selectedNodeIds.add(node.id);
      estimatedTokens += nodeTokens;
    }

    const selectedEdges: Edge[] = [];
    for (const edge of edges) {
      if (!selectedNodeIds.has(edge.from_id) || !selectedNodeIds.has(edge.to_id)) {
        continue;
      }

      const edgeTokens = estimateTokens(edge);
      if (estimatedTokens + edgeTokens > tokenBudget) {
        break;
      }
      selectedEdges.push(edge);
      estimatedTokens += edgeTokens;
    }

    const selectedExcerpts: Excerpt[] = [];
    for (const excerpt of excerpts) {
      const excerptTokens = estimateTokens(excerpt);
      if (estimatedTokens + excerptTokens > tokenBudget) {
        break;
      }
      selectedExcerpts.push(excerpt);
      estimatedTokens += excerptTokens;
    }

    return {
      topic: normalizedTopic,
      depth: normalizedDepth,
      max_tokens: tokenBudget,
      estimated_tokens: estimatedTokens,
      nodes: selectedNodes,
      edges: selectedEdges,
      excerpts: selectedExcerpts,
    };
  }

  computeContentHash(): string {
    const snapshot = {
      nodes: (this.db.prepare("SELECT * FROM nodes ORDER BY id").all() as NodeRow[]).map(parseNodeRow),
      edges: (this.db.prepare("SELECT * FROM edges ORDER BY id").all() as EdgeRow[]).map(parseEdgeRow),
      excerpts: (this.db.prepare("SELECT * FROM excerpts ORDER BY id").all() as ExcerptRow[]).map(
        parseExcerptRow,
      ),
    };
    return computeContentHash(snapshot);
  }

  exportManifest(): GraphManifest {
    const nodeCount = this.db.prepare("SELECT COUNT(1) AS count FROM nodes").get() as {
      count: number;
    };
    const edgeCount = this.db.prepare("SELECT COUNT(1) AS count FROM edges").get() as {
      count: number;
    };
    const excerptCount = this.db.prepare("SELECT COUNT(1) AS count FROM excerpts").get() as {
      count: number;
    };

    return GraphManifestSchema.parse({
      schema_version: "1.0.0",
      generated_at: new Date().toISOString(),
      project_root: this.repoRoot,
      graph_path: relative(this.repoRoot, this.graphPath) || ".axicontext/graph/graph.sqlite",
      content_hash: this.computeContentHash(),
      stats: {
        nodes: nodeCount.count,
        edges: edgeCount.count,
        excerpts: excerptCount.count,
      },
    });
  }

  writeManifest(): GraphManifest {
    const manifest = this.exportManifest();
    mkdirSync(join(this.repoRoot, ".axicontext"), { recursive: true });
    writeFileSync(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }
}
