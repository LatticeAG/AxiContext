import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { describe, expect, it } from "vitest";

import { GitSourceAdapter } from "../../adapters-git/src/index.js";
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
      expect(commitNodes).toHaveLength(30);

      const manifestNodes = result.nodes.filter((node) => node.type === "package_manifest");
      expect(manifestNodes.some((node) => node.attributes.path === "package.json")).toBe(true);

      const dependencies = result.nodes.filter((node) => node.type === "dependency");
      expect(dependencies.some((node) => node.attributes.name === "express")).toBe(true);
      expect(dependencies.some((node) => node.attributes.name === "react")).toBe(true);

      const lockfileNode = result.nodes.find(
        (node) => node.type === "lockfile" && node.attributes.path === "package-lock.json"
      );
      expect(lockfileNode).toBeDefined();
      expect(lockfileNode?.attributes.hash).toMatch(/^sha256:/);
      expect(String(lockfileNode?.attributes.hash)).not.toContain("lockfileVersion");

      const readmeNode = result.nodes.find((node) => node.type === "readme" && node.attributes.path === "README.md");
      expect(readmeNode).toBeDefined();
      const excerpt = String(readmeNode?.attributes.excerpt ?? "");
      expect(excerpt.split("\n").length).toBeLessThanOrEqual(200);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("runSync writes manifest and PROJECT_CONTEXT.md", async () => {
    const repoRoot = await createTempFixtureRepo();
    try {
      const result = await runSync(repoRoot, { maxChars: 10_000 });

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
      expect(projectContext).toContain("## Monorepo/Packages");
      expect(projectContext).toContain("## Architecture");
      expect(projectContext).toContain("## Key Entry Points");
      expect(projectContext).toContain("## Auth & Security");
      expect(projectContext).toContain("## Tooling");
      expect(projectContext).toContain("## Open Issues");
      expect(projectContext).toContain("## Provenance");
      expect(projectContext.length).toBeLessThanOrEqual(10_000);
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
  await execFile("git", ["-C", tempRoot, "add", "."]);
  await execFile("git", ["-C", tempRoot, "commit", "-m", "initial fixture commit"]);

  for (let index = 1; index <= 34; index += 1) {
    await execFile("git", ["-C", tempRoot, "commit", "--allow-empty", "-m", `fixture commit ${index}`]);
  }

  await writeFile(path.join(tempRoot, "docs", "README.md"), "# Docs README\n\nUpdated fixture docs.\n", "utf8");
  await execFile("git", ["-C", tempRoot, "add", "docs/README.md"]);
  await execFile("git", ["-C", tempRoot, "commit", "-m", "update docs readme"]);
  return tempRoot;
}
