import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

import { analyzeRepo } from "@latticeag/axicontext-parsers";
import type { ManifestFact, PathFact, RepoAnalysis } from "@latticeag/axicontext-parsers";

import type {
  AdapterResult,
  GraphEdge,
  GraphNode,
  IngestContext,
  RepoContext,
  SourceAdapter,
} from "@latticeag/axicontext-core";

const execFile = promisify(execFileCallback);

interface DependencyNodeRecord {
  name: string;
  ecosystem: string;
  versions: Set<string>;
  kinds: Set<string>;
  manifests: Set<string>;
}

interface CommitRecord {
  sha: string;
  date: string;
  message: string;
}

interface ExcerptRecord {
  text: string;
  startLine: number;
  endLine: number;
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
    const analysis = await analyzeRepo(ctx.repoRoot, {
      maxDepth: ctx.config.maxTreeDepth,
    });
    const warnings = [...analysis.warnings];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const projectNodeId = projectId(analysis.project_name);
    const dependencyMap = new Map<string, DependencyNodeRecord>();

    const commits = await this.readCommits(ctx.repoRoot, ctx.config.maxCommits, warnings);
    const excerptCommit = commits[0]?.sha;
    const fileFacts = collectFileFacts(analysis);
    const excerptPaths = [...fileFacts.values()]
      .filter((fact) => isExcerptRole(fact.role))
      .map((fact) => fact.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, ctx.config.maxFiles);
    const excerpts = new Map<string, ExcerptRecord>();

    for (const relativePath of excerptPaths) {
      const excerpt = await this.readExcerpt(ctx.repoRoot, relativePath, ctx.config.maxLinesPerFile, warnings);
      if (!excerpt) {
        continue;
      }
      excerpts.set(relativePath, excerpt);
    }

    nodes.push({
      id: projectNodeId,
      type: "project",
      attributes: compactObject({
        name: analysis.project_name,
        root: analysis.root,
        ecosystems: analysis.ecosystems,
        mixed: analysis.mixed,
        package_manager: analysis.package_manager,
        analysis_digest: analysis.digest,
      }),
    });

    for (const manifest of analysis.manifests) {
      const manifestNodeId = moduleId(manifest.path);
      nodes.push({
        id: manifestNodeId,
        type: "module",
        attributes: manifestAttributes(manifest),
      });
      edges.push({
        from: projectNodeId,
        to: manifestNodeId,
        type: "contains",
      });

      for (const dep of manifest.dependencies) {
        const depNodeId = dependencyId(manifest.ecosystem, dep.name);
        const record =
          dependencyMap.get(depNodeId) ??
          {
            name: dep.name,
            ecosystem: manifest.ecosystem,
            versions: new Set<string>(),
            kinds: new Set<string>(),
            manifests: new Set<string>(),
          };
        if (dep.version) {
          record.versions.add(dep.version);
        }
        record.kinds.add(dep.kind);
        record.manifests.add(manifest.path);
        dependencyMap.set(depNodeId, record);
        edges.push({
          from: manifestNodeId,
          to: depNodeId,
          type: "depends_on",
          attributes: compactObject({
            kind: dep.kind,
            version: dep.version,
            manifest: manifest.path,
          }),
        });
      }
    }

    for (const [depNodeId, dep] of [...dependencyMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const versions = [...dep.versions].sort((a, b) => a.localeCompare(b));
      nodes.push({
        id: depNodeId,
        type: "dependency",
        attributes: compactObject({
          name: dep.name,
          ecosystem: dep.ecosystem,
          version: versions.length === 1 ? versions[0] : undefined,
          versions,
          kinds: [...dep.kinds].sort((a, b) => a.localeCompare(b)),
          manifests: [...dep.manifests].sort((a, b) => a.localeCompare(b)),
        }),
      });
    }

    for (const fact of [...fileFacts.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const excerpt = excerpts.get(fact.path);
      const hash = fact.role === "lockfile" ? await this.hashFile(ctx.repoRoot, fact.path, warnings) : undefined;
      nodes.push({
        id: fileId(fact.path),
        type: "file",
        attributes: compactObject({
          path: fact.path,
          role: fact.role,
          roles: fact.roles,
          size_bytes: fact.size_bytes,
          hash,
          excerpt: excerpt?.text,
          excerpt_provenance: excerpt
            ? compactObject({
                adapter: this.id,
                path: fact.path,
                commit: excerptCommit,
                start_line: excerpt.startLine,
                end_line: excerpt.endLine,
              })
            : undefined,
        }),
      });
      edges.push({
        from: projectNodeId,
        to: fileId(fact.path),
        type: "contains",
      });
    }

    nodes.push({
      id: treeId(analysis.tree.digest),
      type: "tree_digest",
      attributes: {
        digest: analysis.tree.digest,
        file_count: analysis.tree.files.length,
        max_depth: ctx.config.maxTreeDepth,
      },
    });
    edges.push({
      from: projectNodeId,
      to: treeId(analysis.tree.digest),
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
        from: projectNodeId,
        to: nodeId,
        type: "references",
      });
    }

    const digest = sha256(
      stableStringify({
        analysis_digest: analysis.digest,
        commits,
      })
    );

    return {
      adapterId: this.id,
      nodes,
      edges,
      digest,
      warnings,
      metadata: {
        files: fileFacts.size,
        files_excerpted: excerpts.size,
        manifests: analysis.manifests.length,
        lockfiles: analysis.lockfiles.length,
        commits: commits.length,
        analysis_digest: analysis.digest,
      },
    };
  }

  private async readExcerpt(
    repoRoot: string,
    relativePath: string,
    maxLinesPerFile: number,
    warnings: string[]
  ): Promise<ExcerptRecord | null> {
    try {
      const content = await readFile(path.join(repoRoot, relativePath), "utf8");
      const lines = content.split(/\r?\n/).slice(0, maxLinesPerFile);
      const text = lines.join("\n");
      if (!text.trim()) {
        return null;
      }
      return {
        text,
        startLine: 1,
        endLine: lines.length,
      };
    } catch (error) {
      warnings.push(`Failed to read excerpt for ${relativePath}: ${toMessage(error)}`);
      return null;
    }
  }

  private async hashFile(repoRoot: string, relativePath: string, warnings: string[]): Promise<string | undefined> {
    try {
      return sha256(await readFile(path.join(repoRoot, relativePath), "utf8"));
    } catch (error) {
      warnings.push(`Failed to hash file ${relativePath}: ${toMessage(error)}`);
      return undefined;
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

interface FileNodeFact extends PathFact {
  roles: string[];
}

function collectFileFacts(analysis: RepoAnalysis): Map<string, FileNodeFact> {
  const files = new Map<string, FileNodeFact>();
  const manifestPaths = new Set(analysis.manifests.map((manifest) => normalizePath(manifest.path)));
  for (const file of analysis.tree.files) {
    if (!manifestPaths.has(normalizePath(file.path))) {
      addFileFact(files, file, "file");
    }
  }
  for (const readme of analysis.readmes) {
    addFileFact(files, readme, "readme");
  }
  for (const file of analysis.important_files) {
    addFileFact(files, file, file.role ?? "important");
  }
  for (const workflow of analysis.workflows) {
    addFileFact(files, workflow, "workflow");
  }
  for (const lockfile of analysis.lockfiles) {
    addFileFact(files, lockfile, "lockfile");
  }
  for (const dockerfile of analysis.dockerfiles) {
    addFileFact(files, dockerfile, "dockerfile");
  }
  for (const composeFile of analysis.compose_files) {
    addFileFact(files, composeFile, "compose");
  }
  for (const makefile of analysis.makefiles) {
    addFileFact(files, makefile, "makefile");
  }
  for (const justfile of analysis.justfiles) {
    addFileFact(files, justfile, "justfile");
  }
  for (const envExample of analysis.env_examples) {
    addFileFact(files, envExample, "env_example");
  }
  return files;
}

function addFileFact(files: Map<string, FileNodeFact>, fact: PathFact, fallbackRole: string): void {
  const normalizedPath = normalizePath(fact.path);
  const role = fact.role ?? fallbackRole;
  const existing = files.get(normalizedPath);
  if (!existing) {
    files.set(normalizedPath, {
      path: normalizedPath,
      role,
      roles: [role],
      size_bytes: fact.size_bytes,
    });
    return;
  }
  if (!existing.roles.includes(role)) {
    existing.roles.push(role);
    existing.roles.sort((a, b) => a.localeCompare(b));
  }
  existing.role = primaryRole(existing.roles);
  existing.size_bytes = existing.size_bytes ?? fact.size_bytes;
}

function primaryRole(roles: string[]): string {
  for (const role of ["readme", "workflow", "lockfile", "docs", "auth", "security", "codeowners", "license"]) {
    if (roles.includes(role)) {
      return role;
    }
  }
  return roles[0] ?? "file";
}

function isExcerptRole(role: string | undefined): boolean {
  return role !== undefined && role !== "file" && role !== "lockfile";
}

function manifestAttributes(manifest: ManifestFact): Record<string, unknown> {
  return compactObject({
    path: normalizePath(manifest.path),
    role: "manifest",
    ecosystem: manifest.ecosystem,
    kind: manifest.kind,
    name: manifest.name,
    size_bytes: manifest.size_bytes,
    dependency_count: manifest.dependencies.length,
    scripts: manifest.scripts,
    engines: manifest.engines,
    package_manager: manifest.package_manager,
    workspaces: manifest.workspaces,
    requires_python: manifest.requires_python,
    build_system: manifest.build_system,
    edition: manifest.edition,
    module: manifest.module,
    go_version: manifest.go_version,
  });
}

function projectId(name: string): string {
  return `project:${name}`;
}

function moduleId(relativePath: string): string {
  return `module:${normalizePath(relativePath)}`;
}

function dependencyId(ecosystem: string, name: string): string {
  return `dep:${ecosystem}:${name}`;
}

function fileId(relativePath: string): string {
  return `file:${normalizePath(relativePath)}`;
}

function treeId(digest: string): string {
  return `tree:${digest}`;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
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

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
