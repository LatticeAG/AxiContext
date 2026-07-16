import { z } from "zod";

export const NodeTypeSchema = z.enum([
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

export const EdgeTypeSchema = z.enum([
  "contains",
  "depends_on",
  "documents",
  "tracked_by",
  "decided_in",
  "references",
  "authored_by",
]);

export const ProvenanceSchema = z.object({
  adapter: z.string().min(1),
  path: z.string().optional(),
  start_line: z.number().int().nonnegative().optional(),
  end_line: z.number().int().nonnegative().optional(),
  commit: z.string().optional(),
  url: z.string().url().optional(),
  ingested_at: z.string().min(1),
});

export const NodeSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  data: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const EdgeSchema = z.object({
  id: z.string().min(1),
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  type: EdgeTypeSchema,
  data: z.record(z.string(), z.unknown()).default({}),
});

export const ExcerptSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  provenance: ProvenanceSchema,
});

export const UpsertNodeInputSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  data: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().min(1).optional(),
  updated_at: z.string().min(1).optional(),
});

export const UpsertEdgeInputSchema = z.object({
  id: z.string().min(1),
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  type: EdgeTypeSchema,
  data: z.record(z.string(), z.unknown()).default({}),
});

export const AddExcerptInputSchema = z.object({
  id: z.string().min(1).optional(),
  text: z.string().min(1),
  provenance: ProvenanceSchema,
});

export const SliceSchema = z.object({
  topic: z.string(),
  depth: z.number().int().nonnegative(),
  max_tokens: z.number().int().positive(),
  estimated_tokens: z.number().int().nonnegative(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  excerpts: z.array(ExcerptSchema),
});

export const GraphManifestSchema = z.object({
  schema_version: z.literal("1.0.0"),
  axictx_version: z.string().min(1),
  generated_at: z.string().min(1),
  project_root: z.string().min(1),
  content_hash: z.string().min(1),
  project_context_hash: z.string().min(1),
  embedding_model: z.literal("none"),
  policy_pack: z.string().min(1),
  adapters: z.record(
    z.string(),
    z.object({
      digest: z.string().min(1),
      ingested_at: z.string().min(1),
      stats: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
      warnings: z.array(z.string()).default([]),
    }),
  ),
  stats: z.object({
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    excerpt_count: z.number().int().nonnegative(),
  }),
});

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type EdgeType = z.infer<typeof EdgeTypeSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Excerpt = z.infer<typeof ExcerptSchema>;
export type UpsertNodeInput = z.infer<typeof UpsertNodeInputSchema>;
export type UpsertEdgeInput = z.infer<typeof UpsertEdgeInputSchema>;
export type AddExcerptInput = z.infer<typeof AddExcerptInputSchema>;
export type GraphSlice = z.infer<typeof SliceSchema>;
export type GraphManifest = z.infer<typeof GraphManifestSchema>;

export function exportJsonSchemas() {
  return {
    nodeType: { type: "string", enum: NodeTypeSchema.options },
    edgeType: { type: "string", enum: EdgeTypeSchema.options },
    provenance: {
      type: "object",
      required: ["adapter", "ingested_at"],
      properties: {
        adapter: { type: "string" },
        path: { type: "string" },
        start_line: { type: "integer", minimum: 0 },
        end_line: { type: "integer", minimum: 0 },
        commit: { type: "string" },
        url: { type: "string", format: "uri" },
        ingested_at: { type: "string" },
      },
    },
    node: {
      type: "object",
      required: ["id", "type", "data", "created_at", "updated_at"],
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: NodeTypeSchema.options },
        data: { type: "object" },
        created_at: { type: "string" },
        updated_at: { type: "string" },
      },
    },
    edge: {
      type: "object",
      required: ["id", "from_id", "to_id", "type", "data"],
      properties: {
        id: { type: "string" },
        from_id: { type: "string" },
        to_id: { type: "string" },
        type: { type: "string", enum: EdgeTypeSchema.options },
        data: { type: "object" },
      },
    },
    excerpt: {
      type: "object",
      required: ["id", "text", "provenance"],
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        provenance: { type: "object" },
      },
    },
    graphManifest: {
      type: "object",
      required: [
        "schema_version",
        "generated_at",
        "project_root",
        "content_hash",
        "project_context_hash",
        "embedding_model",
        "policy_pack",
        "adapters",
        "stats",
      ],
      properties: {
        schema_version: { type: "string", const: "1.0.0" },
        axictx_version: { type: "string" },
        generated_at: { type: "string" },
        project_root: { type: "string" },
        content_hash: { type: "string" },
        project_context_hash: { type: "string" },
        embedding_model: { type: "string", const: "none" },
        policy_pack: { type: "string" },
        adapters: { type: "object" },
        stats: {
          type: "object",
          required: ["node_count", "edge_count", "excerpt_count"],
          properties: {
            node_count: { type: "integer", minimum: 0 },
            edge_count: { type: "integer", minimum: 0 },
            excerpt_count: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    graphSlice: {
      type: "object",
      required: ["topic", "depth", "max_tokens", "estimated_tokens", "nodes", "edges", "excerpts"],
      properties: {
        topic: { type: "string" },
        depth: { type: "integer", minimum: 0 },
        max_tokens: { type: "integer", minimum: 1 },
        estimated_tokens: { type: "integer", minimum: 0 },
        nodes: { type: "array", items: { type: "object" } },
        edges: { type: "array", items: { type: "object" } },
        excerpts: { type: "array", items: { type: "object" } },
      },
    },
  };
}
