import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GraphStore } from "../src/graphStore.js";
import { queryContext } from "../src/query.js";

const tmpDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "axictx-query-"));
  tmpDirs.push(repoRoot);
  return repoRoot;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("queryContext", () => {
  it("ranks path keyword hits above body-only hits", async () => {
    const repoRoot = await makeTempRepo();
    const store = GraphStore.open(repoRoot);
    try {
      store.addExcerpt({
        text: "Generic implementation notes mention auth repeatedly.",
        provenance: {
          adapter: "git",
          path: "src/payments/session.ts",
          ingested_at: "2026-07-16T00:00:00.000Z",
        },
      });
      store.addExcerpt({
        text: "Login handler implementation details.",
        provenance: {
          adapter: "git",
          path: "src/auth/login.ts",
          ingested_at: "2026-07-16T00:00:00.000Z",
        },
      });
      store.writeManifest({ git: { digest: "sha256:adapter" } });
    } finally {
      store.close();
    }

    const result = await queryContext(repoRoot, { question: "auth", max_tokens: 1000 });

    expect(result.answer_context.map((excerpt) => excerpt.path)).toEqual([
      "src/auth/login.ts",
      "src/payments/session.ts",
    ]);
  });

  it("hints to sync when no graph exists and no fallback excerpts match", async () => {
    const repoRoot = await makeTempRepo();

    const result = await queryContext(repoRoot, { question: "zzzzzz", max_tokens: 1000 });

    expect(result.answer_context).toEqual([]);
    expect(result.hint).toBe("run axictx sync");
  });

  it("hints to try fewer keywords when a synced graph has no hits", async () => {
    const repoRoot = await makeTempRepo();
    const store = GraphStore.open(repoRoot);
    try {
      store.addExcerpt({
        text: "Authentication implementation details.",
        provenance: {
          adapter: "git",
          path: "src/auth/login.ts",
          ingested_at: "2026-07-16T00:00:00.000Z",
        },
      });
      store.writeManifest({ git: { digest: "sha256:adapter" } });
    } finally {
      store.close();
    }

    const result = await queryContext(repoRoot, { question: "zzzzzz", max_tokens: 1000 });

    expect(result.answer_context).toEqual([]);
    expect(result.hint).toBe("try fewer keywords");
  });
});
