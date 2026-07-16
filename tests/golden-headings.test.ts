import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSync, scaffoldAxiContext, type SourceAdapter } from "@latticeag/axicontext-core";

const fixtureRoot = path.resolve("testdata/fixtures/minimal-node-repo");
const expectedHeadingsPath = path.resolve("testdata/expected/minimal-node-headings.txt");
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PROJECT_CONTEXT golden headings", () => {
  it("emits all minimal-node headings in order", async () => {
    const repoPath = await copyFixture("axictx-golden-");
    await scaffoldAxiContext({ repoRoot: repoPath });

    const result = await runSync(repoPath, {
      adapters: [minimalNodeAdapter()],
    });
    const expectedHeadings = (await readFile(expectedHeadingsPath, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    let searchOffset = 0;
    for (const heading of expectedHeadings) {
      const foundAt = result.projectContext.indexOf(heading, searchOffset);
      expect(foundAt, `Expected heading "${heading}" after offset ${searchOffset}`).toBeGreaterThanOrEqual(0);
      searchOffset = foundAt + heading.length;
    }
  });
});

async function copyFixture(prefix: string): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(repoPath);
  await cp(fixtureRoot, repoPath, { recursive: true });
  return repoPath;
}

function minimalNodeAdapter(): SourceAdapter {
  return {
    id: "minimal-node",
    async detect() {
      return true;
    },
    async ingest() {
      return {
        adapterId: "minimal-node",
        digest: "sha256:minimal-node",
        warnings: [],
        metadata: {
          files: 2,
        },
        nodes: [
          {
            id: "project:minimal-node-repo",
            type: "project",
            attributes: {
              name: "minimal-node-repo",
              ecosystems: ["node"],
            },
          },
          {
            id: "module:package.json",
            type: "module",
            attributes: {
              path: "package.json",
              ecosystem: "node",
              name: "minimal-node-repo",
            },
          },
          {
            id: "file:README.md",
            type: "file",
            attributes: {
              path: "README.md",
              role: "readme",
              excerpt: "# Minimal Node Fixture\n\nThis fixture repository is used to validate Git adapter ingestion.",
              excerpt_provenance: {
                adapter: "minimal-node",
                path: "README.md",
                start_line: 1,
                end_line: 3,
              },
            },
          },
          {
            id: "file:src/auth/session.ts",
            type: "file",
            attributes: {
              path: "src/auth/session.ts",
              role: "auth",
              excerpt: "export function createSession(userId: string): string {\n  return `session:${userId}`;\n}",
              excerpt_provenance: {
                adapter: "minimal-node",
                path: "src/auth/session.ts",
                start_line: 1,
                end_line: 3,
              },
            },
          },
        ],
        edges: [
          {
            from: "project:minimal-node-repo",
            to: "module:package.json",
            type: "contains",
          },
          {
            from: "project:minimal-node-repo",
            to: "file:README.md",
            type: "contains",
          },
          {
            from: "project:minimal-node-repo",
            to: "file:src/auth/session.ts",
            type: "contains",
          },
        ],
      };
    },
  };
}
