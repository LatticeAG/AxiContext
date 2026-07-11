import { getContextSummary } from "./context.js";
import type { ContextExcerpt, QueryRequest, QueryResult } from "./types.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length > 2);
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

export async function queryContext(
  repoPath: string,
  request: QueryRequest
): Promise<QueryResult> {
  const summary = await getContextSummary(repoPath);
  const maxTokens = Math.max(200, request.max_tokens ?? 4000);
  const include = request.include ?? ["code", "docs", "manifest"];
  const keywords = tokenize(request.question);

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

  const selected: ContextExcerpt[] = [];
  let usedTokens = 0;
  for (const excerpt of ranked) {
    if (usedTokens + excerpt.tokens > maxTokens) {
      continue;
    }
    usedTokens += excerpt.tokens;
    selected.push(excerpt);
  }

  const selectedPaths = new Set(selected.map((excerpt) => excerpt.path));
  const nodes = summary.nodes.filter(
    (node) => !node.path || selectedPaths.has(node.path) || node.type !== "file"
  );

  return {
    question: request.question,
    max_tokens: maxTokens,
    include,
    answer_context: selected,
    nodes,
    manifest_version: summary.manifest.schema_version
  };
}
