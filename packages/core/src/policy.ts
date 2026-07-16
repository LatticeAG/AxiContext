import type { Edge, Excerpt, Node } from "./graph-types.js";

export interface PolicyConfig {
  denylist_globs: string[];
  redact_patterns: string[];
}

export interface RedactionMatch {
  pattern_id: string;
  count: number;
}

export interface RedactTextResult {
  text: string;
  redacted: boolean;
  matches: RedactionMatch[];
}

export interface ApplyPolicyInput {
  nodes: Node[];
  edges: Edge[];
  excerpts: Excerpt[];
}

export interface ApplyPolicyResult extends ApplyPolicyInput {
  denied_paths: string[];
  redactions: RedactionMatch[];
}

interface RedactionPattern {
  id: string;
  pattern: RegExp;
}

const DEFAULT_REDACTION_PATTERNS: RedactionPattern[] = [
  { id: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
  {
    id: "pem_block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { id: "slack_token", pattern: /xox[baprs]-[A-Za-z0-9-]+/g },
  { id: "github_token", pattern: /(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { id: "jwt", pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g },
];

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      const afterGlobstar = glob[index + 2];
      if (afterGlobstar === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += escapeRegex(char ?? "");
  }
  return new RegExp(`^${source}$`);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathMatchesGlobs(pathValue: string | undefined, globs: string[]): boolean {
  if (!pathValue) {
    return false;
  }
  const normalized = normalizePath(pathValue);
  return globs.some((glob) => globToRegex(normalizePath(glob)).test(normalized));
}

function patternsForConfig(patternIds: string[]): RedactionPattern[] {
  if (patternIds.includes("default")) {
    return DEFAULT_REDACTION_PATTERNS;
  }
  const requested = new Set(patternIds);
  return DEFAULT_REDACTION_PATTERNS.filter((pattern) => requested.has(pattern.id));
}

function mergeRedactions(redactions: RedactionMatch[]): RedactionMatch[] {
  const counts = new Map<string, number>();
  for (const redaction of redactions) {
    counts.set(redaction.pattern_id, (counts.get(redaction.pattern_id) ?? 0) + redaction.count);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pattern_id, count]) => ({ pattern_id, count }));
}

export function redactText(text: string, patternIds: string[] = ["default"]): RedactTextResult {
  let redactedText = text;
  const matches: RedactionMatch[] = [];

  for (const { id, pattern } of patternsForConfig(patternIds)) {
    let count = 0;
    redactedText = redactedText.replace(pattern, () => {
      count += 1;
      return `[REDACTED:${id}]`;
    });
    if (count > 0) {
      matches.push({ pattern_id: id, count });
    }
  }

  return {
    text: redactedText,
    redacted: matches.length > 0,
    matches,
  };
}

export function applyPolicy(input: ApplyPolicyInput, config: PolicyConfig): ApplyPolicyResult {
  const deniedPaths = new Set<string>();
  const deniedNodeIds = new Set<string>();
  const nodePathById = new Map<string, string>();

  for (const node of input.nodes) {
    const pathValue = node.data.path;
    const nodePath = typeof pathValue === "string" ? pathValue : undefined;
    if (nodePath) {
      nodePathById.set(node.id, nodePath);
    }
    if (pathMatchesGlobs(nodePath, config.denylist_globs)) {
      deniedNodeIds.add(node.id);
      if (nodePath) {
        deniedPaths.add(nodePath);
      }
    }
  }

  const redactions: RedactionMatch[] = [];
  const redactedPaths = new Set<string>();
  const excerpts: Excerpt[] = [];

  for (const excerpt of input.excerpts) {
    const excerptPath = excerpt.provenance.path;
    if (pathMatchesGlobs(excerptPath, config.denylist_globs)) {
      if (excerptPath) {
        deniedPaths.add(excerptPath);
      }
      continue;
    }

    const redacted = redactText(excerpt.text, config.redact_patterns);
    if (redacted.redacted) {
      redactions.push(...redacted.matches);
      if (excerptPath) {
        redactedPaths.add(excerptPath);
      }
    }
    excerpts.push({ ...excerpt, text: redacted.text });
  }

  const nodes = input.nodes
    .filter((node) => !deniedNodeIds.has(node.id))
    .map((node) => {
      const nodePath = nodePathById.get(node.id);
      if (!nodePath || !redactedPaths.has(nodePath)) {
        return node;
      }
      return {
        ...node,
        data: {
          ...node.data,
          secret_risk: true,
        },
      };
    });

  const survivingNodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.edges.filter(
    (edge) => survivingNodeIds.has(edge.from_id) && survivingNodeIds.has(edge.to_id),
  );

  return {
    nodes,
    edges,
    excerpts,
    denied_paths: [...deniedPaths].sort((a, b) => a.localeCompare(b)),
    redactions: mergeRedactions(redactions),
  };
}
