import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { describe, expect, it } from "vitest";

import { GitSourceAdapter } from "../../adapters-git/src/index.js";
import { DEFAULT_CONFIG_TOML } from "../src/constants.js";
import { GraphStore } from "../src/graphStore.js";
import { runSync } from "../src/sync.js";

const execFile = promisify(execFileCallback);

const FIXTURE_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../testdata/fixtures/minimal-node-repo"
);

describe("git adapter and sync pipeline", () => {
  it("ingests git context with bounded excerpts and lockfile hashes", async () => {
    const repoRoot = await createTempFixtureRepo();
    try {
      const adapter = new GitSourceAdapter();
      const detected = await adapter.detect({ repoRoot });
      expect(detected).toBe(true);

      const result = await adapter.ingest({
        repoRoot,
        config: {
          maxChars: 80_000,
          maxCommits: 30,
          maxFiles: 50,
          maxLinesPerFile: 200,
          maxTreeDepth: 3,
          manifestPath: path.join(".axicontext", "manifest.json"),
          projectContextPath: "PROJECT_CONTEXT.md",
        },
      });

      expect(result.adapterId).toBe("git");
      expect(result.warnings).toEqual([]);

      const commitNodes = result.nodes.filter((node) => node.type === "commit");
      expect(commitNodes.length).toBeGreaterThan(0);
      expect(commitNodes.length).toBeLessThanOrEqual(30);

      const projectNode = result.nodes.find((node) => node.id === "project:minimal-node-repo" && node.type === "project");
      expect(projectNode).toBeDefined();

      const manifestNode = result.nodes.find((node) => node.id === "module:package.json" && node.type === "module");
      expect(manifestNode?.attributes.path).toBe("package.json");

      const dependencies = result.nodes.filter((node) => node.type === "dependency");
      expect(dependencies.some((node) => node.id === "dep:node:express" && node.attributes.name === "express")).toBe(true);
      expect(dependencies.some((node) => node.id === "dep:node:react" && node.attributes.name === "react")).toBe(true);

      const lockfileNode = result.nodes.find(
        (node) => node.id === "file:package-lock.json" && node.type === "file" && node.attributes.path === "package-lock.json"
      );
      expect(lockfileNode).toBeDefined();
      expect(lockfileNode?.attributes.role).toBe("lockfile");
      expect(lockfileNode?.attributes.hash).toMatch(/^sha256:/);
      expect(String(lockfileNode?.attributes.hash)).not.toContain("lockfileVersion");

      const treeNode = result.nodes.find((node) => node.type === "tree_digest");
      expect(treeNode?.id).toMatch(/^tree:[a-f0-9]{64}$/);

      const readmeNode = result.nodes.find((node) => node.id === "file:README.md" && node.type === "file");
      expect(readmeNode).toBeDefined();
      expect(readmeNode?.attributes.role).toBe("readme");
      const excerpt = String(readmeNode?.attributes.excerpt ?? "");
      expect(excerpt.split("\n").length).toBeLessThanOrEqual(200);
      expect(readmeNode?.attributes.excerpt_provenance).toMatchObject({
        adapter: "git",
        path: "README.md",
        start_line: 1,
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("runSync writes manifest and PROJECT_CONTEXT.md", async () => {
    const repoRoot = await createTempFixtureRepo();
    try {
      const result = await runSync(repoRoot, {
        adapters: [new GitSourceAdapter()],
        maxChars: 10_000,
      });

      const manifestJson = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
        schema_version: string;
        adapters: Record<string, { digest: string }>;
        stats: { node_count: number };
      };
      expect(manifestJson.schema_version).toBe("1.0.0");
      expect(manifestJson.adapters.git.digest).toMatch(/^sha256:/);
      expect(manifestJson.stats.node_count).toBeGreaterThan(0);

      const projectContext = await readFile(result.projectContextPath, "utf8");
      expect(projectContext.startsWith("<!-- axi:generated managed-by=axictx schema=1.0.0 hash=sha256:")).toBe(true);
      expect(projectContext).toContain("## Overview");
      expect(projectContext).toContain("## Monorepo / Packages");
      expect(projectContext).toContain("## Architecture");
      expect(projectContext).toContain("## Key Entry Points");
      expect(projectContext).toContain("## Auth & Security");
      expect(projectContext).toContain("## Data & Storage");
      expect(projectContext).toContain("## APIs & Integrations");
      expect(projectContext).toContain("## Tooling & Local Dev");
      expect(projectContext).toContain("## Open Issues & Active Work");
      expect(projectContext).toContain("## Decisions (ADRs)");
      expect(projectContext).toContain("## Glossary");
      expect(projectContext).toContain("## Provenance & Manifest");
      expect(projectContext.length).toBeLessThanOrEqual(10_000);

      const store = GraphStore.open(repoRoot);
      try {
        const readmeExcerpt = store.listExcerpts().find((excerpt) => excerpt.provenance.path === "README.md");
        expect(readmeExcerpt?.provenance).toMatchObject({
          adapter: "git",
          path: "README.md",
          start_line: 1,
        });
        expect(readmeExcerpt?.provenance.ingested_at).toEqual(expect.any(String));
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);
});

async function createTempFixtureRepo(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "axictx-fixture-"));
  await cp(FIXTURE_ROOT, tempRoot, { recursive: true });

  await execFile("git", ["-C", tempRoot, "init", "-b", "main"]);
  await execFile("git", ["-C", tempRoot, "config", "user.email", "fixture@example.com"]);
  await execFile("git", ["-C", tempRoot, "config", "user.name", "Fixture Bot"]);
  await execFile("git", ["-C", tempRoot, "config", "commit.gpgsign", "false"]);
  await execFile("git", ["-C", tempRoot, "add", "."]);
  await execFile("git", ["-C", tempRoot, "commit", "--no-gpg-sign", "-m", "initial fixture commit"]);

  for (let index = 1; index <= 5; index += 1) {
    await execFile("git", [
      "-C",
      tempRoot,
      "commit",
      "--allow-empty",
      "--no-gpg-sign",
      "-m",
      `fixture commit ${index}`,
    ]);
  }

  await writeFile(path.join(tempRoot, "docs", "README.md"), "# Docs README\n\nUpdated fixture docs.\n", "utf8");
  await execFile("git", ["-C", tempRoot, "add", "docs/README.md"]);
  await execFile("git", ["-C", tempRoot, "commit", "--no-gpg-sign", "-m", "update docs readme"]);
  await mkdir(path.join(tempRoot, ".axicontext"), { recursive: true });
  await writeFile(path.join(tempRoot, ".axicontext", "config.toml"), DEFAULT_CONFIG_TOML, "utf8");
  return tempRoot;
}
