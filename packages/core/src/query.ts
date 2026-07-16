import path from "node:path";
import { getContextSummary, loadManifest } from "./context.js";
import { fileExists } from "./fs-utils.js";
import { GraphStore } from "./graphStore.js";
import type { Excerpt } from "./graph-types.js";
import type { ContextExcerpt, QueryRequest, QueryResult } from "./types.js";

const STOP_WORDS = new Set([
  "about",
  "does",
  "from",
  "handled",
  "have",
  "what",
  "when",
  "where",
  "which",
  "with",
  "work"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function tokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function graphPath(repoPath: string): string {
  return path.join(repoPath, ".axicontext", "graph", "graph.sqlite");
}

function sourceTypeForPath(excerptPath: string): ContextExcerpt["source_type"] {
  const lower = excerptPath.toLowerCase();
  if (lower.endsWith(".md") || lower.startsWith("docs/")) {
    return "docs";
  }
  if (lower.includes("manifest")) {
    return "manifest";
  }
  return excerptPath ? "code" : "unknown";
}

function graphExcerptToContextExcerpt(excerpt: Excerpt): ContextExcerpt {
  const excerptPath = excerpt.provenance.path ?? "";
  return {
    id: excerpt.id,
    path: excerptPath,
    source_type: sourceTypeForPath(excerptPath),
    text: excerpt.text,
    tokens: tokenCount(excerpt.text),
    ...(excerpt.provenance.start_line !== undefined ? { start_line: excerpt.provenance.start_line } : {}),
    ...(excerpt.provenance.end_line !== undefined ? { end_line: excerpt.provenance.end_line } : {}),
    provenance: excerpt.provenance
  };
}

function includeExcerpt(excerpt: ContextExcerpt, include: QueryRequest["include"]): boolean {
  const selected = include ?? ["code", "docs", "manifest"];
  if (excerpt.source_type === "unknown") {
    return false;
  }
  return selected.includes(excerpt.source_type);
}

function scoreExcerpt(excerpt: ContextExcerpt, keywords: string[]): number {
  const haystack = `${excerpt.path}\n${excerpt.text}`.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      score += 1;
    }
  }
  return score;
}

function collectGraphMatches(store: GraphStore, question: string, keywords: string[]): ContextExcerpt[] {
  const queries = keywords.length > 0 ? [keywords.join(" "), ...keywords] : [question];
  const byId = new Map<string, ContextExcerpt>();

  for (const query of queries) {
    for (const excerpt of store.searchExcerpts(query, 50)) {
      byId.set(excerpt.id, graphExcerptToContextExcerpt(excerpt));
    }
    if (byId.size >= 50) {
      break;
    }
  }

  return [...byId.values()];
}

function packExcerpts(excerpts: ContextExcerpt[], maxTokens: number): {
  selected: ContextExcerpt[];
  tokensUsed: number;
} {
  const selected: ContextExcerpt[] = [];
  let tokensUsed = 0;
  for (const excerpt of excerpts) {
    if (tokensUsed + excerpt.tokens > maxTokens) {
      continue;
    }
    tokensUsed += excerpt.tokens;
    selected.push(excerpt);
  }
  return { selected, tokensUsed };
}

export async function queryContext(
  repoPath: string,
  request: QueryRequest
): Promise<QueryResult> {
  const maxTokens = Math.max(200, request.max_tokens ?? 4000);
  const include = request.include ?? ["code", "docs", "manifest"];
  const keywords = tokenize(request.question);

  if (await fileExists(graphPath(repoPath))) {
    const manifest = await loadManifest(repoPath);
    if (!manifest) {
      throw new Error("AxiContext manifest is missing; run axictx sync before querying the graph.");
    }

    const store = GraphStore.open(repoPath);
    try {
      const ranked = collectGraphMatches(store, request.question, keywords)
        .filter((excerpt) => includeExcerpt(excerpt, include))
        .map((excerpt) => ({
          excerpt,
          score: scoreExcerpt(excerpt, keywords)
        }))
        .sort((a, b) => b.score - a.score || a.excerpt.tokens - b.excerpt.tokens)
        .map((entry) => entry.excerpt);
      const packed = packExcerpts(ranked, maxTokens);

      return {
        question: request.question,
        answer_context: packed.selected,
        tokens_used: packed.tokensUsed,
        manifest_version: manifest.schema_version
      };
    } finally {
      store.close();
    }
  }

  const summary = await getContextSummary(repoPath);

  const pool = summary.excerpts.filter((excerpt) => {
    if (excerpt.source_type === "manifest" && include.includes("manifest")) {
      return true;
    }
    if (excerpt.source_type === "docs" && include.includes("docs")) {
      return true;
    }
    if (excerpt.source_type === "code" && include.includes("code")) {
      return true;
    }
    return false;
  });

  const ranked = pool
    .map((excerpt) => ({
      excerpt,
      score: scoreExcerpt(excerpt, keywords)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.excerpt.tokens - b.excerpt.tokens)
    .map((entry) => entry.excerpt);

  const packed = packExcerpts(ranked, maxTokens);

  return {
    question: request.question,
    answer_context: packed.selected,
    tokens_used: packed.tokensUsed,
    manifest_version: summary.manifest.schema_version,
    warning: "No .axicontext/graph/graph.sqlite found; run axictx sync for graph-backed query results."
  };
}
