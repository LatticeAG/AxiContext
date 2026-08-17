import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Edge, Excerpt, GraphManifest, Node } from "./graph-types.js";
import { sha256 } from "./utils.js";

interface ProjectContextInput {
  repoRoot: string;
  nodes: Node[];
  edges?: Edge[];
  excerpts?: Excerpt[];
  manifest: GraphManifest;
  config: {
    maxChars: number;
    projectContextPath?: string;
  };
  existingContent?: string;
}

export function generateProjectContext(input: ProjectContextInput): string {
  const repoNode = input.nodes.find((node) => node.type === "project");
  const repoName = stringData(repoNode, "name") ?? path.basename(input.repoRoot);
  const moduleNodes = sortedById(input.nodes.filter((node) => node.type === "module"));
  const fileNodes = sortedById(input.nodes.filter((node) => node.type === "file" || node.type === "doc"));
  const depNodes = sortedById(input.nodes.filter((node) => node.type === "dependency"));
  const commitNodes = sortedById(input.nodes.filter((node) => node.type === "commit"));
  const issueNodes = sortedById(input.nodes.filter((node) => node.type === "issue"));
  const decisionNodes = sortedById(input.nodes.filter((node) => node.type === "decision"));
  const excerpts = input.excerpts ?? [];
  const ecosystems = uniqueStrings(moduleNodes.map((node) => stringData(node, "ecosystem")));
  const filePaths = uniqueStrings(fileNodes.map((node) => stringData(node, "path")));
  const depNames = uniqueStrings(depNodes.map((node) => stringData(node, "name")));
  const readmeHeadings = readReadmeHeadings(input.repoRoot, filePaths);
  const manualBlocks = extractManualBlocks(input.existingContent ?? readExistingProjectContext(input));

  const sectionBodies: Array<[string, string[]]> = [
    [
      "Overview",
      [
        `- Repository: \`${repoName}\``,
        `- Source adapters: ${Object.keys(input.manifest.adapters).sort().join(", ") || "none"}`,
        `- Detected ecosystems: ${ecosystems.join(", ") || "unknown"}`,
        `- Recent commits captured: ${commitNodes.length}`,
      ],
    ],
    [
      "Monorepo / Packages",
      moduleNodes.map((node) => {
        const nodePath = stringData(node, "path") ?? node.id;
        const ecosystem = stringData(node, "ecosystem") ?? "unknown";
        return `- \`${nodePath}\` (${ecosystem})`;
      }),
    ],
    ["Architecture", buildArchitectureSignals(filePaths, depNames, moduleNodes.length)],
    [
      "Key Entry Points",
      filePaths
        .filter((entry) => /(^README|^docs\/|^src\/index|^app\/|^cmd\/|^main\.|^server\.)/i.test(entry))
        .slice(0, 12)
        .map((entry) => `- \`${entry}\``),
    ],
    ["Auth & Security", buildAuthSecurity(filePaths, input.nodes)],
    ["Data & Storage", buildDataStorage(depNames, filePaths)],
    ["APIs & Integrations", buildApisIntegrations(depNames, filePaths)],
    ["Tooling & Local Dev", buildTooling(filePaths, depNodes)],
    [
      "Open Issues & Active Work",
      issueNodes.map((node) => {
        const title = stringData(node, "title") ?? node.id;
        const url = stringData(node, "url");
        return `- ${title}${url ? ` (${url})` : ""}`;
      }),
    ],
    [
      "Decisions (ADRs)",
      buildDecisions(decisionNodes, filePaths),
    ],
    ["Glossary", buildGlossary(depNames, ecosystems, readmeHeadings)],
    ["Provenance & Manifest", buildProvenance(input, excerpts.length)],
  ];

  const lines: string[] = ["# Project Context", ""];
  for (const [heading, body] of sectionBodies) {
    lines.push(`## ${heading}`);
    lines.push(...(body.length > 0 ? body : ["_None detected._"]));
    lines.push("");
  }

  if (manualBlocks.length > 0) {
    lines.push(...manualBlocks);
    lines.push("");
  }

  const body = fitToMaxChars(`${lines.join("\n").trimEnd()}\n`, input.config.maxChars);
  const banner = `<!-- axi:generated managed-by=axictx schema=1.0.0 hash=${sha256(body)} -->`;
  return `${banner}\n${body}`;
}

function sortedById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function stringData(node: Node | undefined, key: string): string | undefined {
  const value = node?.data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readExistingProjectContext(input: ProjectContextInput): string {
  const projectContextPath = path.join(input.repoRoot, input.config.projectContextPath ?? "PROJECT_CONTEXT.md");
  if (!existsSync(projectContextPath)) {
    return "";
  }
  return readFileSync(projectContextPath, "utf8");
}

function readReadmeHeadings(repoRoot: string, filePaths: string[]): string[] {
  const readmePath =
    filePaths.find((entry) => /^README(\.|$)/i.test(path.basename(entry)) && !entry.includes("/")) ??
    filePaths.find((entry) => /^README(\.|$)/i.test(path.basename(entry)));
  if (!readmePath) {
    return [];
  }

  try {
    const content = readFileSync(path.join(repoRoot, readmePath), "utf8");
    const headings = content
      .split(/\r?\n/)
      .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
      .filter((heading): heading is string => typeof heading === "string" && heading.length > 0)
      .map((heading) => heading.replace(/\s+#+$/, "").trim())
      .filter(Boolean);
    return uniqueStrings(headings).slice(0, 12);
  } catch {
    return [];
  }
}

function extractManualBlocks(content: string): string[] {
  const blocks: string[] = [];
  const pattern = /<!-- axi:manual -->[\s\S]*?<!-- \/axi:manual -->/g;
  for (const match of content.matchAll(pattern)) {
    blocks.push(match[0].trim());
  }
  return blocks;
}

function fitToMaxChars(body: string, maxChars: number): string {
  const bannerBudget = "<!-- axi:generated managed-by=axictx schema=1.0.0 hash=sha256: -->\n".length + 64;
  const budget = Math.max(0, maxChars - bannerBudget);
  if (body.length <= budget) {
    return body;
  }
  const notice = "\n<!-- truncated: max_chars reached -->\n";
  return `${body.slice(0, Math.max(0, budget - notice.length)).trimEnd()}${notice}`;
}

function buildArchitectureSignals(filePaths: string[], depNames: string[], moduleCount: number): string[] {
  const signals: string[] = [];
  const deps = new Set(depNames.map((value) => value.toLowerCase()));
  const paths = filePaths.map((value) => value.toLowerCase());

  if (deps.has("react") || deps.has("next")) {
    signals.push("Frontend application stack detected (React/Next.js dependencies present).");
  }
  if (deps.has("express") || deps.has("fastify") || deps.has("hono")) {
    signals.push("HTTP service architecture likely present (server framework dependency detected).");
  }
  if (deps.has("typescript")) {
    signals.push("TypeScript toolchain detected in dependencies.");
  }
  if (moduleCount > 1) {
    signals.push("Multiple package manifests detected, suggesting a monorepo or poly-package layout.");
  }
  if (paths.some((entry) => entry.startsWith(".github/workflows/"))) {
    signals.push("CI/CD workflows are configured via GitHub Actions.");
  }
  if (paths.some((entry) => entry.includes("/auth/"))) {
    signals.push("Authentication-related modules are present in repository paths.");
  }

  return signals.sort((a, b) => a.localeCompare(b));
}

function buildAuthSecurity(filePaths: string[], nodes: Node[]): string[] {
  const lines: string[] = [];
  const authFiles = filePaths.filter((entry) => /(auth|oauth|session|login|jwt|token|rbac|acl)/i.test(entry));
  const securityFiles = filePaths.filter((entry) => /SECURITY\.md|CODEOWNERS|LICENSE/i.test(entry));
  const secretRiskCount = nodes.filter((node) => node.data.secret_risk === true).length;
  if (authFiles.length > 0) {
    lines.push(...authFiles.slice(0, 10).map((entry) => `- Auth path: \`${entry}\``));
  }
  if (securityFiles.length > 0) {
    lines.push(...securityFiles.slice(0, 10).map((entry) => `- Security metadata: \`${entry}\``));
  }
  if (secretRiskCount > 0) {
    lines.push(`- Redaction policy marked ${secretRiskCount} node(s) with secret risk.`);
  }
  return lines;
}

function buildDataStorage(depNames: string[], filePaths: string[]): string[] {
  const deps = new Set(depNames.map((value) => value.toLowerCase()));
  const paths = filePaths.map((value) => value.toLowerCase());
  const lines: string[] = [];
  const storageDeps = [
    "prisma",
    "@prisma/client",
    "drizzle-orm",
    "drizzle-kit",
    "better-sqlite3",
    "sqlite3",
    "pg",
    "postgres",
    "redis",
    "ioredis",
    "mongodb",
    "mongoose",
  ];
  for (const dep of storageDeps) {
    if (deps.has(dep.toLowerCase())) {
      lines.push(`- Storage dependency: \`${dep}\``);
    }
  }
  const storagePathSignals: Array<[RegExp, string]> = [
    [/(\b|\/)prisma(\/|$)|schema\.prisma$/i, "Prisma schema/config path"],
    [/(\b|\/)drizzle(\/|$)|drizzle\.config\./i, "Drizzle ORM path"],
    [/sqlite|\.sqlite3?$|\.db$/i, "SQLite path"],
    [/postgres|pgsql/i, "Postgres path"],
    [/redis/i, "Redis path"],
    [/mongo/i, "MongoDB path"],
  ];
  for (const [pattern, label] of storagePathSignals) {
    const matched = paths.find((entry) => pattern.test(entry));
    if (matched) {
      lines.push(`- ${label}: \`${matched}\``);
    }
  }
  if (filePaths.some((entry) => /docker-compose.*\.ya?ml$/i.test(entry))) {
    lines.push("- Docker Compose file present, inspect it for local backing services.");
  }
  return uniqueStrings(lines);
}

function buildApisIntegrations(depNames: string[], filePaths: string[]): string[] {
  const deps = new Set(depNames.map((value) => value.toLowerCase()));
  const lines: string[] = [];
  for (const dep of ["express", "fastify", "hono", "next", "@hono/node-server"]) {
    if (deps.has(dep)) {
      lines.push(`- API framework dependency: \`${dep}\``);
    }
  }
  if (filePaths.some((entry) => entry.startsWith(".github/workflows/"))) {
    lines.push("- GitHub Actions workflows are present.");
  }
  return lines;
}

function buildTooling(filePaths: string[], depNodes: Node[]): string[] {
  const lines: string[] = [];
  const lockfilePattern =
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Cargo\.lock|go\.sum)$/i;
  const lockfiles = filePaths.filter((entry) => lockfilePattern.test(entry));
  if (lockfiles.length > 0) {
    lines.push(...lockfiles.slice(0, 10).map((entry) => `- Lockfile: \`${entry}\``));
  }
  if (depNodes.length > 0) {
    lines.push(`- Dependencies parsed: ${depNodes.length}`);
  }
  const workflows = filePaths.filter((entry) => entry.startsWith(".github/workflows/"));
  if (workflows.length > 0) {
    lines.push(...workflows.slice(0, 10).map((entry) => `- Workflow: \`${entry}\``));
  }
  return lines;
}

function buildDecisions(decisionNodes: Node[], filePaths: string[]): string[] {
  const lines = decisionNodes.map((node) => {
    const title = stringData(node, "title") ?? stringData(node, "path") ?? node.id;
    return `- ${title}`;
  });
  const decisionPaths = filePaths.filter((entry) => {
    return /(^|\/)docs\/adr\/|(^|\/)decisions\/|(^|\/)ADR[^/]*\.md$/i.test(entry);
  });
  lines.push(...decisionPaths.slice(0, 12).map((entry) => `- ADR path: \`${entry}\``));
  return uniqueStrings(lines);
}

function buildGlossary(depNames: string[], ecosystems: string[], readmeHeadings: string[]): string[] {
  const lines: string[] = [];
  if (ecosystems.length > 0) {
    lines.push(`- Ecosystems: ${ecosystems.join(", ")}`);
  }
  for (const heading of readmeHeadings) {
    lines.push(`- README heading: ${heading}`);
  }
  for (const dep of depNames.slice(0, 20)) {
    lines.push(`- \`${dep}\`: dependency`);
  }
  return lines;
}

function buildProvenance(input: ProjectContextInput, excerptCount: number): string[] {
  const lines = [
    `- Manifest schema: ${input.manifest.schema_version}`,
    `- Content hash: ${input.manifest.content_hash}`,
    `- Project root: \`${input.manifest.project_root}\``,
    `- Graph stats: ${input.manifest.stats.node_count} nodes, ${input.manifest.stats.edge_count} edges, ${excerptCount} excerpts`,
  ];
  for (const [id, adapter] of Object.entries(input.manifest.adapters).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- Adapter \`${id}\`: digest=${adapter.digest}`);
  }
  return lines;
}
