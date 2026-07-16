import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { getAxiContextConfigPath, loadAxiContextConfig } from "./config.js";
import { DEFAULT_PROJECT_CONTEXT_PATH } from "./constants.js";
import { loadManifest } from "./context.js";
import { fileExists, listRepoFiles, safeReadText, sha256 } from "./fs-utils.js";
import { GraphStore } from "./graphStore.js";
import type { Node } from "./graph-types.js";
import { stableStringify } from "./hash.js";
import type {
  DriftChange,
  DriftFailSeverity,
  DriftReport,
  DriftSeverity,
  Manifest
} from "./types.js";

const execFile = promisify(execFileCallback);

const DEFAULT_FAIL_ON: DriftFailSeverity[] = ["high", "critical"];
const REPORT_FAIL_ON = new WeakMap<DriftReport, DriftFailSeverity[]>();

const ADAPTER_IGNORED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  "target",
  "out"
]);

const MANIFEST_NAMES = new Set(["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml"]);
const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "poetry.lock",
  "Cargo.lock",
  "go.sum",
  "Pipfile.lock",
  "composer.lock"
]);

interface DriftRuntimeConfig {
  failOn: DriftFailSeverity[];
  projectContextPath: string;
  maxFiles: number;
  maxLinesPerFile: number;
  maxTreeDepth: number;
  maxCommits: number;
}

interface DependencyRecord {
  name: string;
  version: string;
  source: string;
}

interface CommitRecord {
  sha: string;
  date: string;
  message: string;
}

interface CurrentSignals {
  adapterDigests: Record<string, string>;
  contentHash?: string;
  fileTreeDigest: string;
  readmeDigest: string;
  directDependencies: string[];
  versionedDependencies: string[];
  authPaths: string[];
  projectContextHash?: string;
}

const SEVERITY_ORDER: DriftSeverity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical"
];

function maxSeverity(a: DriftSeverity, b: DriftSeverity): DriftSeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

function summarize(changes: DriftChange[]) {
  const bySeverity: Record<DriftSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  };
  for (const change of changes) {
    bySeverity[change.severity] += 1;
  }
  return {
    total_changes: changes.length,
    by_severity: bySeverity
  };
}

function hasIgnoredSegment(filePath: string): boolean {
  return filePath.split("/").some((segment) => ADAPTER_IGNORED_SEGMENTS.has(segment));
}

function generatedContextPath(filePath: string, config: DriftRuntimeConfig): boolean {
  return (
    filePath === ".axicontext/manifest.json" ||
    filePath === ".axicontext/graph" ||
    filePath.startsWith(".axicontext/graph/") ||
    filePath === config.projectContextPath
  );
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function rootReadme(filePath: string): boolean {
  return !filePath.includes("/") && /^README/i.test(path.basename(filePath));
}

function docsReadme(filePath: string): boolean {
  return filePath.startsWith("docs/") && /^README/i.test(path.basename(filePath));
}

function importantFile(filePath: string): boolean {
  if (rootReadme(filePath)) {
    return true;
  }
  if (filePath.startsWith("docs/")) {
    return true;
  }
  if (filePath.includes("/auth/") || filePath.startsWith("auth/")) {
    return true;
  }
  if (filePath === "CODEOWNERS" || filePath === "LICENSE" || filePath === "SECURITY.md") {
    return true;
  }
  return filePath.startsWith(".github/workflows/") && filePath.split("/").length === 3;
}

function manifestFile(filePath: string): boolean {
  return MANIFEST_NAMES.has(path.basename(filePath));
}

function lockfile(filePath: string): boolean {
  return LOCKFILE_NAMES.has(path.basename(filePath));
}

function normalizeReadmeText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function parsePackageJsonDependencies(content: string, directOnly: boolean): DependencyRecord[] {
  const parsed = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const records: DependencyRecord[] = [];
  const sources: Array<keyof typeof parsed> = directOnly
    ? ["dependencies"]
    : ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

  for (const source of sources) {
    const section = parsed[source];
    if (!section) {
      continue;
    }
    for (const [name, version] of Object.entries(section)) {
      records.push({ name, version, source });
    }
  }
  return records;
}

function extractQuotedValues(value: string): string[] {
  const matches = value.match(/"([^"]+)"/g) ?? [];
  return matches.map((entry) => entry.slice(1, -1));
}

function splitPythonDependency(raw: string, source: string): DependencyRecord {
  const [name, version = "*"] = raw.split(/(?=[<>=~!])/);
  return {
    name: name.trim(),
    version: version.trim() || "*",
    source
  };
}

function parsePyprojectDependencies(content: string): DependencyRecord[] {
  const records: DependencyRecord[] = [];
  const projectDepsMatch = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[(?<deps>[\s\S]*?)\]/m);
  if (projectDepsMatch?.groups?.deps) {
    for (const dep of extractQuotedValues(projectDepsMatch.groups.deps)) {
      records.push(splitPythonDependency(dep, "project.dependencies"));
    }
  }
  return records;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCargoDependencies(content: string): DependencyRecord[] {
  const records: DependencyRecord[] = [];
  const sections = ["dependencies", "dev-dependencies", "build-dependencies", "workspace.dependencies"];
  for (const section of sections) {
    const sectionRegex = new RegExp(`\\[${escapeRegex(section)}\\]([\\s\\S]*?)(?:\\n\\[|$)`, "m");
    const match = content.match(sectionRegex);
    if (!match?.[1]) {
      continue;
    }
    for (const line of match[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const tuple = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (!tuple) {
        continue;
      }
      const rhs = tuple[2].trim();
      const versionMatch = rhs.startsWith("\"") ? rhs.replace(/^"|"$/g, "") : rhs.match(/version\s*=\s*"([^"]+)"/)?.[1];
      records.push({
        name: tuple[1],
        version: versionMatch ?? "*",
        source: `cargo.${section}`
      });
    }
  }
  return records;
}

async function parseManifestDependencies(repoPath: string, relativePath: string, directOnly: boolean): Promise<DependencyRecord[]> {
  const content = await safeReadText(path.join(repoPath, relativePath));
  try {
    if (relativePath.endsWith("package.json")) {
      return parsePackageJsonDependencies(content, directOnly);
    }
    if (relativePath.endsWith("pyproject.toml")) {
      return parsePyprojectDependencies(content);
    }
    if (relativePath.endsWith("Cargo.toml")) {
      return parseCargoDependencies(content);
    }
  } catch {
    return [];
  }
  return [];
}

async function collectDependencies(repoPath: string, manifestFiles: string[], directOnly: boolean): Promise<DependencyRecord[]> {
  const records: DependencyRecord[] = [];
  for (const manifestPath of sortStrings(manifestFiles)) {
    records.push(...(await parseManifestDependencies(repoPath, manifestPath, directOnly)));
  }
  return records.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

function dependencyKey(record: DependencyRecord, simple: boolean): string {
  return simple ? record.name : `${record.name}@${record.version}`;
}

async function readCommits(repoPath: string, maxCommits: number): Promise<CommitRecord[]> {
  try {
    const { stdout } = await execFile("git", [
      "-C",
      repoPath,
      "log",
      `-n${maxCommits}`,
      "--date=iso-strict",
      "--pretty=format:%H%x09%ad%x09%s"
    ]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, date, ...messageParts] = line.split("\t");
        return {
          sha,
          date,
          message: messageParts.join("\t")
        };
      });
  } catch {
    return [];
  }
}

async function buildTreeSummary(repoPath: string, maxDepth: number, config: DriftRuntimeConfig): Promise<string> {
  const lines: string[] = [];

  async function walk(relativeDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(path.join(repoPath, relativeDir), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && ADAPTER_IGNORED_SEGMENTS.has(entry.name)) {
        continue;
      }
      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (generatedContextPath(childRelative, config)) {
        continue;
      }
      lines.push(`${"  ".repeat(depth)}${childRelative}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory()) {
        await walk(childRelative, depth + 1);
      }
    }
  }

  await walk("", 0);
  return lines.join("\n");
}

async function resolveRuntimeConfig(repoPath: string): Promise<DriftRuntimeConfig> {
  if (await fileExists(getAxiContextConfigPath(repoPath))) {
    const config = await loadAxiContextConfig(repoPath);
    return {
      failOn: config.drift.fail_on,
      projectContextPath: config.project_context.path,
      maxFiles: config.adapters.git.max_excerpt_files,
      maxLinesPerFile: config.adapters.git.max_lines_per_file,
      maxTreeDepth: config.adapters.git.tree_max_depth,
      maxCommits: config.adapters.git.recent_commits
    };
  }

  return {
    failOn: DEFAULT_FAIL_ON,
    projectContextPath: DEFAULT_PROJECT_CONTEXT_PATH,
    maxFiles: 50,
    maxLinesPerFile: 200,
    maxTreeDepth: 3,
    maxCommits: 30
  };
}

async function computeGitAdapterDigest(
  repoPath: string,
  files: string[],
  config: DriftRuntimeConfig,
  dependencyRecords: DependencyRecord[],
  treeSummary: string
): Promise<string> {
  const adapterFiles = sortStrings(files.filter((file) => !hasIgnoredSegment(file)));
  const rootReadmes = adapterFiles.filter(rootReadme);
  const docReadmes = adapterFiles.filter(docsReadme);
  const importantFiles = sortStrings(adapterFiles.filter(importantFile)).slice(0, config.maxFiles);
  const manifestFiles = adapterFiles.filter(manifestFile);
  const lockfiles = adapterFiles.filter(lockfile);
  const commits = await readCommits(repoPath, config.maxCommits);
  const dependencies = dependencyRecords.map((record) => [`dep:${record.name}`, record]);

  return sha256(
    stableStringify({
      rootReadmes,
      docReadmes,
      importantFiles,
      manifests: manifestFiles,
      lockfiles,
      dependencies,
      commits,
      treeSummary
    })
  );
}

function graphPath(repoPath: string): string {
  return path.join(repoPath, ".axicontext", "graph", "graph.sqlite");
}

function nodeString(node: Node, key: string): string | undefined {
  const value = node.data[key];
  return typeof value === "string" ? value : undefined;
}

function readGraphSignals(repoPath: string): {
  contentHash?: string;
  readmeDigest?: string;
  directDependencies?: string[];
  authPaths?: string[];
  fileTreeDigest?: string;
} {
  const store = GraphStore.open(repoPath);
  try {
    const nodes = store.listNodes();
    const dependencies = nodes
      .filter((node) => node.type === "dependency")
      .map((node) => {
        const name = nodeString(node, "name") ?? node.id.replace(/^dep:/, "");
        const version = nodeString(node, "version");
        return version ? `${name}@${version}` : name;
      });
    const authPaths = nodes
      .filter((node) => node.type === "file")
      .map((node) => nodeString(node, "path"))
      .filter((entry): entry is string => entry !== undefined)
      .filter((entry) => /(auth|oauth|session|login|jwt|token|rbac|acl)/i.test(entry));
    const readmeNode = nodes.find((node) => node.type === "file" && /(^README|README)/i.test(path.basename(nodeString(node, "path") ?? "")));
    const readmeExcerpt = readmeNode ? nodeString(readmeNode, "excerpt") : undefined;
    const treeNode = nodes.find((node) => node.type === "tree_digest");

    return {
      contentHash: store.computeContentHash(),
      readmeDigest: readmeExcerpt ? sha256(normalizeReadmeText(readmeExcerpt)) : undefined,
      directDependencies: sortStrings(dependencies),
      authPaths: sortStrings(authPaths),
      fileTreeDigest: treeNode ? nodeString(treeNode, "digest") : undefined
    };
  } finally {
    store.close();
  }
}

async function collectCurrentSignals(repoPath: string, config: DriftRuntimeConfig): Promise<CurrentSignals> {
  const files = await listRepoFiles(repoPath);
  const visibleFiles = files.filter((file) => !hasIgnoredSegment(file) && !generatedContextPath(file, config));
  const treeSummary = await buildTreeSummary(repoPath, config.maxTreeDepth, config);
  const fileTreeDigest = sha256(treeSummary);

  const readmeCandidates = sortStrings(visibleFiles.filter((p) => /^README/i.test(path.basename(p))));
  const readmePath = readmeCandidates[0] ?? "README.md";
  const readmeContent = await safeReadText(path.join(repoPath, readmePath));
  const readmeDigest = sha256(normalizeReadmeText(readmeContent));

  const manifestFiles = visibleFiles.filter(manifestFile);
  const directOnlyRecords = await collectDependencies(repoPath, manifestFiles, true);
  const allDependencyRecords = await collectDependencies(repoPath, manifestFiles, false);
  const directDependencies = sortStrings(directOnlyRecords.map((record) => dependencyKey(record, true)));
  const versionedDependencies = sortStrings(allDependencyRecords.map((record) => dependencyKey(record, false)));

  let contentHash: string | undefined;
  if (await fileExists(graphPath(repoPath))) {
    const store = GraphStore.open(repoPath);
    try {
      contentHash = store.computeContentHash();
    } finally {
      store.close();
    }
  }

  const authPaths = visibleFiles.filter((file) =>
    /(auth|oauth|session|login|jwt|token|rbac|acl)/i.test(file)
  );

  return {
    adapterDigests: {
      git: await computeGitAdapterDigest(repoPath, visibleFiles, config, allDependencyRecords, treeSummary)
    },
    contentHash,
    fileTreeDigest,
    readmeDigest,
    directDependencies,
    versionedDependencies,
    authPaths: sortStrings(authPaths),
    projectContextHash: await hashProjectContext(repoPath, config.projectContextPath)
  };
}

async function hashProjectContext(repoPath: string, projectContextPath: string): Promise<string | undefined> {
  const absolutePath = path.join(repoPath, projectContextPath);
  if (!(await fileExists(absolutePath))) {
    return undefined;
  }
  return sha256(await safeReadText(absolutePath));
}

function readAdapterDigest(
  manifest: Manifest,
  candidates: string[]
): string | undefined {
  for (const candidate of candidates) {
    const entry = manifest.adapters[candidate];
    if (entry?.digest) {
      return entry.digest;
    }
  }
  return undefined;
}

function readAdapterList(
  manifest: Manifest,
  candidates: string[],
  key: "direct" | "deps" | "paths"
): string[] {
  for (const candidate of candidates) {
    const entry = manifest.adapters[candidate];
    const value = entry?.[key];
    if (Array.isArray(value)) {
      return [...value].sort();
    }
  }
  return [];
}

function readBaselineDependencies(manifest: Manifest, graphSignals?: ReturnType<typeof readGraphSignals>): string[] {
  const direct = readAdapterList(manifest, ["dependencies", "deps"], "direct");
  if (direct.length > 0) {
    return direct;
  }
  const deps = readAdapterList(manifest, ["dependencies", "deps"], "deps");
  if (deps.length > 0) {
    return deps;
  }
  return graphSignals?.directDependencies ?? [];
}

function readBaselineAuthPaths(manifest: Manifest, graphSignals?: ReturnType<typeof readGraphSignals>): string[] {
  const paths = readAdapterList(manifest, ["auth_paths", "auth"], "paths");
  return paths.length > 0 ? paths : graphSignals?.authPaths ?? [];
}

function simpleDependencyComparison(previousDependencies: string[]): boolean {
  return previousDependencies.every((dependency) => !dependency.includes("@") && !dependency.includes(":"));
}

function collectManifestChanges(
  manifest: Manifest,
  current: CurrentSignals,
  graphSignals?: ReturnType<typeof readGraphSignals>
): DriftChange[] {
  const changes: DriftChange[] = [];

  const schemaVersion = manifest.schema_version;
  if (!schemaVersion.startsWith("1.")) {
    changes.push({
      kind: "manifest.schema_mismatch",
      severity: "high",
      detail: `manifest schema ${schemaVersion} is incompatible with drift engine`
    });
  }

  for (const [adapterId, adapter] of Object.entries(manifest.adapters)) {
    const currentDigest = current.adapterDigests[adapterId];
    if (!adapter.digest || !currentDigest || adapter.digest === currentDigest) {
      continue;
    }
    changes.push({
      kind: "adapter.digest.changed",
      severity: "medium",
      detail: `adapter ${adapterId} digest changed`,
      path: ".axicontext/manifest.json",
      before: adapter.digest,
      after: currentDigest
    });
  }

  if (manifest.content_hash && current.contentHash && manifest.content_hash !== current.contentHash) {
    changes.push({
      kind: "content_hash.changed",
      severity: "info",
      detail: "graph content hash changed",
      path: ".axicontext/manifest.json",
      before: manifest.content_hash,
      after: current.contentHash
    });
  }

  const previousFileTreeDigest = readAdapterDigest(manifest, ["file_tree", "tree_digest"]) ?? graphSignals?.fileTreeDigest;
  if (previousFileTreeDigest && previousFileTreeDigest !== current.fileTreeDigest) {
    changes.push({
      kind: "file_tree.changed",
      severity: "info",
      detail: "file tree digest changed",
      before: previousFileTreeDigest,
      after: current.fileTreeDigest
    });
  }

  const previousReadmeDigest = readAdapterDigest(manifest, ["readme", "git_readme"]) ?? graphSignals?.readmeDigest;
  if (previousReadmeDigest && previousReadmeDigest !== current.readmeDigest) {
    changes.push({
      kind: "readme.changed",
      severity: "medium",
      detail: "README digest changed",
      before: previousReadmeDigest,
      after: current.readmeDigest
    });
  }

  const previousDependencies = readBaselineDependencies(manifest, graphSignals);
  if (previousDependencies.length > 0) {
    const currentDependencies = simpleDependencyComparison(previousDependencies)
      ? current.directDependencies
      : current.versionedDependencies;
    const previous = new Set(previousDependencies);
    const currentSet = new Set(currentDependencies);
    const newlyAdded = currentDependencies.filter((dep) => !previous.has(dep));
    const removed = previousDependencies.filter((dep) => !currentSet.has(dep));
    if (newlyAdded.length > 0 || removed.length > 0) {
      changes.push({
        kind: "dependencies.changed",
        severity: "medium",
        detail: `dependency set changed (${[
          newlyAdded.length > 0 ? `added: ${newlyAdded.join(", ")}` : "",
          removed.length > 0 ? `removed: ${removed.join(", ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ")})`
      });
    }
    for (const dep of newlyAdded) {
      changes.push({
        kind: "dependency.added",
        severity: "medium",
        detail: `new direct dependency detected: ${dep}`
      });
    }
    for (const dep of removed) {
      changes.push({
        kind: "dependency.removed",
        severity: "low",
        detail: `direct dependency removed: ${dep}`
      });
    }
  }

  const previousAuthPaths = readBaselineAuthPaths(manifest, graphSignals);
  if (previousAuthPaths.length > 0) {
    const previous = new Set(previousAuthPaths);
    const currentSet = new Set(current.authPaths);
    const added = current.authPaths.filter((p) => !previous.has(p));
    const removed = previousAuthPaths.filter((p) => !currentSet.has(p));

    if (added.length > 0 || removed.length > 0) {
      const details = [
        added.length > 0 ? `added: ${added.join(", ")}` : "",
        removed.length > 0 ? `removed: ${removed.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join(" | ");
      changes.push({
        kind: "auth_paths.changed",
        severity: "high",
        detail: `auth path set changed (${details})`
      });
    }
  }

  if (
    manifest.project_context_hash &&
    current.projectContextHash &&
    manifest.project_context_hash !== current.projectContextHash
  ) {
    changes.push({
      kind: "project_context_hash.changed",
      severity: "low",
      detail: "PROJECT_CONTEXT.md hash changed",
      path: "PROJECT_CONTEXT.md",
      before: manifest.project_context_hash,
      after: current.projectContextHash
    });
  }

  return changes;
}

export async function detectDrift(repoPath: string): Promise<DriftReport> {
  const config = await resolveRuntimeConfig(repoPath);
  const manifestPath = path.join(repoPath, ".axicontext", "manifest.json");

  let changes: DriftChange[] = [];
  if (!(await fileExists(manifestPath))) {
    changes = [
      {
        kind: "manifest.missing",
        severity: "critical",
        detail: "manifest is missing; run axictx sync"
      }
    ];
  } else {
    const manifest = await loadManifest(repoPath);
    const current = await collectCurrentSignals(repoPath, config);
    const graphSignals = (await fileExists(graphPath(repoPath))) ? readGraphSignals(repoPath) : undefined;
    changes = manifest
      ? collectManifestChanges(manifest, current, graphSignals)
      : [
          {
            kind: "manifest.missing",
            severity: "critical",
            detail: "manifest is unreadable; run axictx sync",
            path: ".axicontext/manifest.json"
          }
        ];
  }

  let severity: DriftSeverity = "info";
  for (const change of changes) {
    severity = maxSeverity(severity, change.severity);
  }

  const report = {
    status: changes.length > 0 ? "drift" : "ok",
    severity,
    generated_at: new Date().toISOString(),
    changes,
    summary: summarize(changes)
  } satisfies DriftReport;
  REPORT_FAIL_ON.set(report, config.failOn);
  return report;
}

export function formatDriftMarkdown(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`# AxiContext Drift Report`);
  lines.push("");
  lines.push(`- status: **${report.status}**`);
  lines.push(`- severity: **${report.severity}**`);
  lines.push(`- generated_at: \`${report.generated_at}\``);
  lines.push(`- total_changes: ${report.summary.total_changes}`);
  lines.push("");

  if (report.changes.length === 0) {
    lines.push("No drift detected.");
    return lines.join("\n");
  }

  lines.push("## Changes");
  for (const change of report.changes) {
    lines.push(
      `- [${change.severity}] \`${change.kind}\` — ${change.detail}${
        change.path ? ` (${change.path})` : ""
      }`
    );
  }

  return lines.join("\n");
}

export function formatDriftGithubAnnotations(report: DriftReport): string[] {
  const levelMap: Record<DriftSeverity, "notice" | "warning" | "error"> = {
    info: "notice",
    low: "warning",
    medium: "warning",
    high: "error",
    critical: "error"
  };

  return report.changes.map((change) => {
    const level = levelMap[change.severity];
    const location = change.path ? `file=${change.path},` : "";
    return `::${level} ${location}title=AxiContext Drift::[${change.severity}] ${change.kind} - ${change.detail}`;
  });
}

export function formatDriftJson(report: DriftReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatDriftSarif(report: DriftReport): string {
  const rules = [...new Set(report.changes.map((change) => change.kind))].map((kind) => ({
    id: kind,
    shortDescription: {
      text: kind
    }
  }));
  const levelMap: Record<DriftSeverity, "note" | "warning" | "error"> = {
    info: "note",
    low: "warning",
    medium: "warning",
    high: "error",
    critical: "error"
  };
  const results = report.changes.map((change) => ({
    ruleId: change.kind,
    level: levelMap[change.severity],
    message: {
      text: `[${change.severity}] ${change.detail}`
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: change.path ?? ".axicontext/manifest.json"
          },
          region: {
            startLine: 1
          }
        }
      }
    ]
  }));

  return `${JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "AxiContext Drift",
              informationUri: "https://github.com/LatticeAG/AxiContext",
              rules
            }
          },
          results
        }
      ]
    },
    null,
    2
  )}\n`;
}

export function shouldFailOnDrift(
  report: DriftReport,
  failOn: readonly DriftSeverity[] = REPORT_FAIL_ON.get(report) ?? DEFAULT_FAIL_ON
): boolean {
  const failingSeverities = new Set<DriftSeverity>(failOn);
  return report.changes.some((change) => failingSeverities.has(change.severity));
}
