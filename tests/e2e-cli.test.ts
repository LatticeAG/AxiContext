import { execFile as execFileCallback } from "node:child_process";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectDrift,
  queryContext,
  runSync,
  scaffoldAxiContext,
  type SourceAdapter,
} from "@latticeag/axicontext-core";

const execFile = promisify(execFileCallback);
const fixtureRoot = path.resolve("testdata/fixtures/minimal-node-repo");
const cliPath = path.resolve("packages/cli/dist/axictx-cli.js");
const tmpDirs: string[] = [];

interface QueryJson {
  answer_context: Array<{
    path: string;
    text: string;
    provenance: {
      path?: string;
    };
  }>;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("axictx fixture e2e", () => {
  it("runs init, sync, drift, and query against the minimal node fixture", async () => {
    const repoPath = await copyFixture("axictx-e2e-");
    await execFile("git", ["init"], { cwd: repoPath });

    if (await pathExists(cliPath)) {
      await runCli(repoPath, ["init"]);
      await runCli(repoPath, ["sync"]);
      const drift = await runCli(repoPath, ["drift", "--json"]);
      expect(JSON.parse(drift.stdout)).toMatchObject({ status: "ok" });

      const query = await runCli(repoPath, ["query", "session auth", "--json"]);
      expect(queryHasSessionHit(parseQueryJson(query.stdout))).toBe(true);
      return;
    }

    await scaffoldAxiContext({ repoRoot: repoPath });
    await runSync(repoPath, {
      adapters: [minimalNodeAdapter()],
    });

    await expect(detectDrift(repoPath)).resolves.toMatchObject({ status: "ok" });
    const query = await queryContext(repoPath, {
      question: "session auth",
      max_tokens: 1000,
    });
    expect(query.answer_context.some((excerpt) => excerpt.path === "src/auth/session.ts")).toBe(true);
  });
});

async function copyFixture(prefix: string): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(repoPath);
  await cp(fixtureRoot, repoPath, { recursive: true });
  return repoPath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFile(process.execPath, [cliPath, ...args], { cwd });
}

function parseQueryJson(raw: string): QueryJson {
  const parsed: unknown = JSON.parse(raw);
  if (!isQueryJson(parsed)) {
    throw new Error("CLI query output did not match the expected JSON shape.");
  }
  return parsed;
}

function isQueryJson(value: unknown): value is QueryJson {
  if (value === null || typeof value !== "object" || !("answer_context" in value)) {
    return false;
  }
  const answerContext = value.answer_context;
  return Array.isArray(answerContext) && answerContext.every(isQueryExcerpt);
}

function isQueryExcerpt(value: unknown): value is QueryJson["answer_context"][number] {
  if (!isRecord(value) || !isRecord(value.provenance)) {
    return false;
  }
  return (
    typeof value.path === "string" &&
    typeof value.text === "string" &&
    (value.provenance.path === undefined || typeof value.provenance.path === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function queryHasSessionHit(query: QueryJson): boolean {
  return query.answer_context.some((excerpt) => {
    return excerpt.path === "src/auth/session.ts" || excerpt.provenance.path === "src/auth/session.ts";
  });
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
          files: 1,
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
            to: "file:src/auth/session.ts",
            type: "contains",
          },
        ],
      };
    },
  };
}
