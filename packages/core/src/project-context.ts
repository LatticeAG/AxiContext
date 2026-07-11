import path from "node:path";

import type { GraphNode, ResolvedSyncConfig, SyncManifest } from "./types.js";
import { sha256 } from "./utils.js";

interface ProjectContextInput {
  repoRoot: string;
  nodes: GraphNode[];
  manifest: SyncManifest;
  config: ResolvedSyncConfig;
}

export function generateProjectContext(input: ProjectContextInput): string {
  const repoNode = input.nodes.find((node) => node.type === "repo");
  const repoName = (repoNode?.attributes.name as string | undefined) ?? path.basename(input.repoRoot);

  const manifestNodes = input.nodes
    .filter((node) => node.type === "package_manifest")
    .sort((a, b) => a.id.localeCompare(b.id));
  const fileNodes = input.nodes
    .filter((node) => node.type === "important_file" || node.type === "readme")
    .sort((a, b) => a.id.localeCompare(b.id));
  const depNodes = input.nodes
    .filter((node) => node.type === "dependency")
    .sort((a, b) => a.id.localeCompare(b.id));
  const commitNodes = input.nodes
    .filter((node) => node.type === "commit")
    .sort((a, b) => a.id.localeCompare(b.id));
  const lockNodes = input.nodes
    .filter((node) => node.type === "lockfile")
    .sort((a, b) => a.id.localeCompare(b.id));

  const ecosystems = new Set<string>();
  for (const manifestNode of manifestNodes) {
    const ecosystem = manifestNode.attributes.ecosystem;
    if (typeof ecosystem === "string") {
      ecosystems.add(ecosystem);
    }
  }

  const architectureSignals = buildArchitectureSignals(fileNodes, depNodes, manifestNodes);
  const keyEntryPoints = fileNodes
    .map((node) => node.attributes.path)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => /(^README|^docs\/|^src\/index|^app\/|^cmd\/|^main\.)/i.test(value))
    .slice(0, 12);

  const authFiles = fileNodes
    .map((node) => node.attributes.path)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value.toLowerCase().includes("/auth/"));
  const securityFiles = fileNodes
    .map((node) => node.attributes.path)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => /SECURITY\.md|CODEOWNERS|LICENSE/i.test(value));

  const sections: string[] = [];
  sections.push("# Project Context");
  sections.push("");
  sections.push("## Overview");
  sections.push(`- Repository: \`${repoName}\``);
  sections.push(`- Source adapters: ${Object.keys(input.manifest.adapters).sort().join(", ") || "none"}`);
  sections.push(`- Detected ecosystems: ${[...ecosystems].sort().join(", ") || "unknown"}`);
  sections.push(`- Recent commits captured: ${commitNodes.length}`);
  sections.push("");
  sections.push("## Monorepo/Packages");
  if (manifestNodes.length === 0) {
    sections.push("- No package manifests were detected.");
  } else {
    for (const node of manifestNodes) {
      const nodePath = node.attributes.path as string | undefined;
      const ecosystem = node.attributes.ecosystem as string | undefined;
      sections.push(`- \`${nodePath ?? node.id}\` (${ecosystem ?? "unknown"})`);
    }
  }
  sections.push("");
  sections.push("## Architecture");
  if (architectureSignals.length === 0) {
    sections.push("- Architecture signals were not detected; inspect key entry points and docs.");
  } else {
    sections.push(...architectureSignals.map((signal) => `- ${signal}`));
  }
  sections.push("");
  sections.push("## Key Entry Points");
  if (keyEntryPoints.length === 0) {
    sections.push("- No obvious entry points were detected.");
  } else {
    sections.push(...keyEntryPoints.map((entry) => `- \`${entry}\``));
  }
  sections.push("");
  sections.push("## Auth & Security");
  sections.push(`- Auth-related files detected: ${authFiles.length}`);
  if (authFiles.length > 0) {
    sections.push(...authFiles.slice(0, 10).map((entry) => `- \`${entry}\``));
  }
  if (securityFiles.length > 0) {
    sections.push(...securityFiles.slice(0, 10).map((entry) => `- Security metadata: \`${entry}\``));
  } else {
    sections.push("- No explicit security metadata files detected in important file set.");
  }
  sections.push("");
  sections.push("## Tooling");
  sections.push(`- Lockfiles fingerprinted: ${lockNodes.length}`);
  sections.push(`- Dependencies parsed: ${depNodes.length}`);
  const workflowFiles = fileNodes
    .map((node) => node.attributes.path)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value.startsWith(".github/workflows/"));
  sections.push(`- CI workflows detected: ${workflowFiles.length}`);
  for (const workflow of workflowFiles.slice(0, 10)) {
    sections.push(`- \`${workflow}\``);
  }
  sections.push("");
  sections.push("## Open Issues");
  sections.push("- Placeholder: integrate issue tracker adapters (GitHub, Linear, etc.) to populate active work.");
  sections.push("");
  sections.push("## Provenance");
  sections.push(`- Generated at: ${input.manifest.generated_at}`);
  sections.push(`- Manifest schema: ${input.manifest.schema_version}`);
  sections.push(`- Manifest hash: ${input.manifest.content_hash}`);
  sections.push(`- Project root: \`${input.manifest.project_root}\``);
  const adapters = Object.entries(input.manifest.adapters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, adapter]) => `- Adapter \`${id}\`: digest=${adapter.digest}, nodes=${adapter.node_count}, edges=${adapter.edge_count}`);
  sections.push(...adapters);
  sections.push("");

  let body = `${sections.join("\n")}\n`;
  const temporaryBanner = "<!-- axi:generated managed-by=axictx schema=1.0.0 hash= -->\n";
  const maxBodyLength = Math.max(0, input.config.maxChars - temporaryBanner.length);
  if (body.length > maxBodyLength) {
    const truncationNotice = "\n\n<!-- truncated: max_chars reached -->\n";
    body = `${body.slice(0, Math.max(0, maxBodyLength - truncationNotice.length))}${truncationNotice}`;
  }

  const bodyHash = sha256(body);
  const banner = `<!-- axi:generated managed-by=axictx schema=1.0.0 hash=${bodyHash} -->`;
  return `${banner}\n${body}`;
}

function buildArchitectureSignals(
  fileNodes: GraphNode[],
  depNodes: GraphNode[],
  manifestNodes: GraphNode[]
): string[] {
  const signals: string[] = [];
  const depNames = new Set(
    depNodes
      .map((node) => node.attributes.name)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase())
  );
  const filePaths = fileNodes
    .map((node) => node.attributes.path)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  if (depNames.has("react") || depNames.has("next")) {
    signals.push("Frontend application stack detected (React/Next.js dependencies present).");
  }
  if (depNames.has("express") || depNames.has("fastify") || depNames.has("hono")) {
    signals.push("HTTP service architecture likely present (server framework dependency detected).");
  }
  if (depNames.has("typescript")) {
    signals.push("TypeScript toolchain detected in dependencies.");
  }
  if (manifestNodes.length > 1) {
    signals.push("Multiple package manifests detected, suggesting a monorepo or poly-package layout.");
  }
  if (filePaths.some((entry) => entry.startsWith(".github/workflows/"))) {
    signals.push("CI/CD workflows are configured via GitHub Actions.");
  }
  if (filePaths.some((entry) => entry.includes("/auth/"))) {
    signals.push("Authentication-related modules are present in repository paths.");
  }

  return signals.sort((a, b) => a.localeCompare(b));
}
