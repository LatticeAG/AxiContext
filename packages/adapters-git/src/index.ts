import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

import fg from "fast-glob";

import type {
  AdapterResult,
  GraphEdge,
  GraphNode,
  IngestContext,
  RepoContext,
  SourceAdapter,
} from "./types.js";

const execFile = promisify(execFileCallback);

const IGNORED_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/target/**",
  "**/out/**",
];

const IMPORTANT_GLOBS = [
  "README*",
  "docs/**",
  "**/auth/**",
  "CODEOWNERS",
  "LICENSE",
  "SECURITY.md",
  ".github/workflows/*",
];

const MANIFEST_GLOBS = [
  "**/package.json",
  "**/pyproject.toml",
  "**/Cargo.toml",
  "**/go.mod",
  "**/pom.xml",
];

const LOCKFILE_GLOBS = [
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lockb",
  "**/bun.lock",
  "**/poetry.lock",
  "**/Cargo.lock",
  "**/go.sum",
  "**/Pipfile.lock",
  "**/composer.lock",
];

const SKIP_TREE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "target",
  "out",
  ".turbo",
]);

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

export class GitSourceAdapter implements SourceAdapter {
  id = "git";

  async detect(ctx: RepoContext): Promise<boolean> {
    const gitDir = path.join(ctx.repoRoot, ".git");
    try {
      await access(gitDir);
      return true;
    } catch {
      // Fall through to git command check.
    }

    try {
      const { stdout } = await execFile("git", ["-C", ctx.repoRoot, "rev-parse", "--is-inside-work-tree"]);
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  async ingest(ctx: IngestContext): Promise<AdapterResult> {
    const warnings: string[] = [];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const repoNodeId = `repo:${path.basename(ctx.repoRoot)}`;
    const dependencyMap = new Map<string, DependencyRecord>();

    const rootReadmes = await this.glob(["README*"], ctx.repoRoot);
    const docReadmes = await this.glob(["docs/**/README*"], ctx.repoRoot);
    const importantFiles = await this.glob(IMPORTANT_GLOBS, ctx.repoRoot);
    const manifestFiles = await this.glob(MANIFEST_GLOBS, ctx.repoRoot);
    const lockfiles = await this.glob(LOCKFILE_GLOBS, ctx.repoRoot);
    const commits = await this.readCommits(ctx.repoRoot, ctx.config.maxCommits, warnings);
    const treeSummary = await buildTreeSummary(ctx.repoRoot, ctx.config.maxTreeDepth, warnings);

    const excerptCandidates = [...new Set([...rootReadmes, ...docReadmes, ...importantFiles])];
    const boundedExcerptFiles = excerptCandidates.sort((a, b) => a.localeCompare(b)).slice(0, ctx.config.maxFiles);

    for (const relativePath of boundedExcerptFiles) {
      const excerpt = await this.readExcerpt(ctx.repoRoot, relativePath, ctx.config.maxLinesPerFile, warnings);
      if (!excerpt) {
        continue;
      }
      const fileNodeId = `file:${relativePath}`;
      const type = /(^README|README)/i.test(path.basename(relativePath)) ? "readme" : "important_file";
      nodes.push({
        id: fileNodeId,
        type,
        attributes: {
          path: relativePath,
          excerpt,
        },
      });
      edges.push({
        from: repoNodeId,
        to: fileNodeId,
        type: "contains",
      });
    }

    for (const relativePath of manifestFiles.sort((a, b) => a.localeCompare(b))) {
      const manifestNodeId = `manifest:${relativePath}`;
      const ecosystem = detectEcosystem(relativePath);
      nodes.push({
        id: manifestNodeId,
        type: "package_manifest",
        attributes: {
          path: relativePath,
          ecosystem,
        },
      });
      edges.push({
        from: repoNodeId,
        to: manifestNodeId,
        type: "contains",
      });

      const deps = await this.parseManifestDependencies(ctx.repoRoot, relativePath, warnings);
      for (const dep of deps) {
        const depId = `dep:${dep.name}`;
        dependencyMap.set(depId, dep);
        edges.push({
          from: manifestNodeId,
          to: depId,
          type: "depends_on",
          attributes: {
            version: dep.version,
            source: dep.source,
          },
        });
      }
    }

    for (const [depId, dep] of [...dependencyMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      nodes.push({
        id: depId,
        type: "dependency",
        attributes: {
          name: dep.name,
          version: dep.version,
          source: dep.source,
        },
      });
      edges.push({
        from: repoNodeId,
        to: depId,
        type: "references",
      });
    }

    for (const relativePath of lockfiles.sort((a, b) => a.localeCompare(b))) {
      try {
        const content = await readFile(path.join(ctx.repoRoot, relativePath), "utf8");
        const hash = sha256(content);
        const nodeId = `lockfile:${relativePath}`;
        nodes.push({
          id: nodeId,
          type: "lockfile",
          attributes: {
            path: relativePath,
            hash,
          },
        });
        edges.push({
          from: repoNodeId,
          to: nodeId,
          type: "contains",
        });
      } catch (error) {
        warnings.push(`Failed to hash lockfile ${relativePath}: ${toMessage(error)}`);
      }
    }

    nodes.push({
      id: "tree:summary",
      type: "tree_summary",
      attributes: {
        depth: ctx.config.maxTreeDepth,
        summary: treeSummary,
      },
    });
    edges.push({
      from: repoNodeId,
      to: "tree:summary",
      type: "contains",
    });

    for (const commit of commits) {
      const nodeId = `commit:${commit.sha}`;
      nodes.push({
        id: nodeId,
        type: "commit",
        attributes: {
          sha: commit.sha,
          date: commit.date,
          message: commit.message,
        },
      });
      edges.push({
        from: repoNodeId,
        to: nodeId,
        type: "history",
      });
    }

    const digest = sha256(
      stableStringify({
        rootReadmes,
        docReadmes,
        importantFiles: boundedExcerptFiles,
        manifests: manifestFiles,
        lockfiles,
        dependencies: [...dependencyMap.entries()],
        commits,
        treeSummary,
      })
    );

    return {
      adapterId: this.id,
      nodes,
      edges,
      digest,
      warnings,
      metadata: {
        files_excerpted: boundedExcerptFiles.length,
        manifests: manifestFiles.length,
        lockfiles: lockfiles.length,
        commits: commits.length,
      },
    };
  }

  private async glob(patterns: string[], cwd: string): Promise<string[]> {
    return fg(patterns, {
      cwd,
      dot: false,
      onlyFiles: true,
      unique: true,
      ignore: IGNORED_GLOBS,
    });
  }

  private async readExcerpt(
    repoRoot: string,
    relativePath: string,
    maxLinesPerFile: number,
    warnings: string[]
  ): Promise<string | null> {
    try {
      const content = await readFile(path.join(repoRoot, relativePath), "utf8");
      const lines = content.split(/\r?\n/).slice(0, maxLinesPerFile);
      return lines.join("\n");
    } catch (error) {
      warnings.push(`Failed to read excerpt for ${relativePath}: ${toMessage(error)}`);
      return null;
    }
  }

  private async parseManifestDependencies(
    repoRoot: string,
    relativePath: string,
    warnings: string[]
  ): Promise<DependencyRecord[]> {
    const manifestPath = path.join(repoRoot, relativePath);
    try {
      const content = await readFile(manifestPath, "utf8");
      if (relativePath.endsWith("package.json")) {
        return parsePackageJsonDependencies(content);
      }
      if (relativePath.endsWith("pyproject.toml")) {
        return parsePyprojectDependencies(content);
      }
      if (relativePath.endsWith("Cargo.toml")) {
        return parseCargoDependencies(content);
      }
      return [];
    } catch (error) {
      warnings.push(`Failed to parse dependencies from ${relativePath}: ${toMessage(error)}`);
      return [];
    }
  }

  private async readCommits(repoRoot: string, maxCommits: number, warnings: string[]): Promise<CommitRecord[]> {
    try {
      const { stdout } = await execFile("git", [
        "-C",
        repoRoot,
        "log",
        `-n${maxCommits}`,
        "--date=iso-strict",
        "--pretty=format:%H%x09%ad%x09%s",
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
            message: messageParts.join("\t"),
          };
        });
    } catch (error) {
      warnings.push(`Failed to read git commit history: ${toMessage(error)}`);
      return [];
    }
  }
}

function detectEcosystem(relativePath: string): string {
  const base = path.basename(relativePath);
  if (base === "package.json") {
    return "node";
  }
  if (base === "pyproject.toml") {
    return "python";
  }
  if (base === "Cargo.toml") {
    return "rust";
  }
  if (base === "go.mod") {
    return "go";
  }
  if (base === "pom.xml") {
    return "java";
  }
  return "unknown";
}

function parsePackageJsonDependencies(content: string): DependencyRecord[] {
  const json = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const records: DependencyRecord[] = [];
  const sources: Array<keyof typeof json> = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  for (const source of sources) {
    const section = json[source];
    if (!section) {
      continue;
    }
    for (const [name, version] of Object.entries(section)) {
      records.push({
        name,
        version,
        source,
      });
    }
  }
  return records;
}

function parsePyprojectDependencies(content: string): DependencyRecord[] {
  const records: DependencyRecord[] = [];

  const projectDepsMatch = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[(?<deps>[\s\S]*?)\]/m);
  if (projectDepsMatch?.groups?.deps) {
    const deps = extractQuotedValues(projectDepsMatch.groups.deps);
    for (const dep of deps) {
      records.push(splitPythonDependency(dep, "project.dependencies"));
    }
  }

  const optionalDepsSectionMatch = content.match(/\[project\.optional-dependencies\]([\s\S]*?)(?:\n\[|$)/m);
  if (optionalDepsSectionMatch?.[1]) {
    const lines = optionalDepsSectionMatch[1].split("\n");
    for (const line of lines) {
      const lineMatch = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*\[(.*)\]\s*$/);
      if (!lineMatch) {
        continue;
      }
      const depGroup = lineMatch[1];
      for (const dep of extractQuotedValues(lineMatch[2])) {
        records.push(splitPythonDependency(dep, `project.optional-dependencies.${depGroup}`));
      }
    }
  }

  return records;
}

function splitPythonDependency(raw: string, source: string): DependencyRecord {
  const [name, version = "*"] = raw.split(/(?=[<>=~!])/);
  return {
    name: name.trim(),
    version: version.trim() || "*",
    source,
  };
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

    const lines = match[1].split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const tuple = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (!tuple) {
        continue;
      }
      const depName = tuple[1];
      const rhs = tuple[2].trim();
      let version = "*";
      if (rhs.startsWith("\"")) {
        version = rhs.replace(/^"|"$/g, "");
      } else {
        const versionMatch = rhs.match(/version\s*=\s*"([^"]+)"/);
        if (versionMatch) {
          version = versionMatch[1];
        }
      }

      records.push({
        name: depName,
        version,
        source: `cargo.${section}`,
      });
    }
  }
  return records;
}

async function buildTreeSummary(repoRoot: string, maxDepth: number, warnings: string[]): Promise<string> {
  const lines: string[] = [];

  async function walk(relativeDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    const absoluteDir = path.join(repoRoot, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Failed to read directory for tree summary ${relativeDir || "."}: ${toMessage(error)}`);
      return;
    }

    const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (entry.isDirectory() && SKIP_TREE_DIRS.has(entry.name)) {
        continue;
      }
      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const indent = "  ".repeat(depth);
      const suffix = entry.isDirectory() ? "/" : "";
      lines.push(`${indent}${childRelative}${suffix}`);
      if (entry.isDirectory()) {
        await walk(childRelative, depth + 1);
      }
    }
  }

  await walk("", 0);
  return lines.join("\n");
}

function extractQuotedValues(value: string): string[] {
  const matches = value.match(/"([^"]+)"/g) ?? [];
  return matches.map((entry) => entry.slice(1, -1));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
