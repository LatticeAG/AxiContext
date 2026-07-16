import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { GitSourceAdapter } from "../src/index.js";

const execFile = promisify(execFileCallback);
const FIXTURE_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../testdata/fixtures/minimal-node-repo",
);

describe("GitSourceAdapter", () => {
  it("includes auth/session files in excerpted graph nodes", async () => {
    const repoRoot = await createTempFixtureRepo();
    try {
      const adapter = new GitSourceAdapter();
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

      const sessionNode = result.nodes.find(
        (node) => node.type === "file" && node.attributes.path === "src/auth/session.ts",
      );
      expect(sessionNode?.attributes.role).toBe("auth");
      expect(sessionNode?.attributes.excerpt).toContain("createSession");
      expect(sessionNode?.attributes.excerpt_provenance).toMatchObject({
        adapter: "git",
        path: "src/auth/session.ts",
        start_line: 1,
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);
});

async function createTempFixtureRepo(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "axictx-adapter-git-"));
  await cp(FIXTURE_ROOT, tempRoot, { recursive: true });
  await execFile("git", ["-C", tempRoot, "init", "-b", "main"]);
  await execFile("git", ["-C", tempRoot, "config", "user.email", "fixture@example.com"]);
  await execFile("git", ["-C", tempRoot, "config", "user.name", "Fixture Bot"]);
  await execFile("git", ["-C", tempRoot, "config", "commit.gpgsign", "false"]);
  await execFile("git", ["-C", tempRoot, "add", "."]);
  await execFile("git", ["-C", tempRoot, "commit", "--no-gpg-sign", "-m", "initial fixture commit"]);
  return tempRoot;
}
