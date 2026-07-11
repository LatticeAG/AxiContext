import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAxiContextApp } from "@latticeag/axicontext-server";

const tmpDirs: string[] = [];

async function makeRepoFixture(): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "axictx-server-"));
  tmpDirs.push(repoPath);
  await mkdir(path.join(repoPath, ".axicontext"), { recursive: true });
  await mkdir(path.join(repoPath, "src", "auth"), { recursive: true });
  await mkdir(path.join(repoPath, "docs"), { recursive: true });

  await writeFile(path.join(repoPath, "README.md"), "Authentication and architecture overview.\n", "utf8");
  await writeFile(path.join(repoPath, "docs", "auth.md"), "Auth docs and OAuth details.\n", "utf8");
  await writeFile(path.join(repoPath, "src", "auth", "login.ts"), "export function login() {}\n", "utf8");
  await writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        version: "0.1.0",
        dependencies: {
          jose: "^5.2.0"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    path.join(repoPath, ".axicontext", "manifest.json"),
    `${JSON.stringify(
      {
        schema_version: "1.0.0",
        generated_at: "2026-07-11T00:00:00.000Z",
        adapters: {
          git: { digest: "sha256:any" },
          readme: { digest: "sha256:any" },
          dependencies: { direct: ["jose"] },
          auth_paths: { paths: ["src/auth/login.ts"] }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return repoPath;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Agent Read API routes", () => {
  it("serves all required routes", async () => {
    const repoPath = await makeRepoFixture();
    const app = createAxiContextApp({
      repoPath,
      host: "127.0.0.1",
      port: 8787
    });

    const health = await app.request("/healthz");
    expect(health.status).toBe(200);

    const manifest = await app.request("/v1/manifest");
    expect(manifest.status).toBe(200);
    const manifestJson = await manifest.json();
    expect(manifestJson.schema_version).toBe("1.0.0");

    const context = await app.request("/v1/context?limit=1");
    expect(context.status).toBe(200);
    const contextJson = await context.json();
    expect(Array.isArray(contextJson.summary.excerpts)).toBe(true);
    expect(contextJson.summary.excerpts.length).toBeLessThanOrEqual(1);

    const slice = await app.request("/v1/context/slice?topic=auth&depth=2&max_tokens=2000");
    expect(slice.status).toBe(200);
    const sliceJson = await slice.json();
    expect(sliceJson.topic).toBe("auth");

    const query = await app.request("/v1/context/query", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        question: "Where is authentication handled?",
        max_tokens: 1200
      })
    });
    expect(query.status).toBe(200);
    const queryJson = await query.json();
    expect(Array.isArray(queryJson.answer_context)).toBe(true);

    const drift = await app.request("/v1/drift");
    expect(drift.status).toBe(200);
    const driftJson = await drift.json();
    expect(["ok", "drift"]).toContain(driftJson.status);

    const openApi = await app.request("/v1/openapi.json");
    expect(openApi.status).toBe(200);
    const openApiJson = await openApi.json();
    expect(openApiJson.paths["/v1/context/query"]).toBeDefined();
  });

  it("enforces api token when configured", async () => {
    const repoPath = await makeRepoFixture();
    const app = createAxiContextApp({
      repoPath,
      host: "127.0.0.1",
      port: 8787,
      apiToken: "test-token"
    });

    const unauthorized = await app.request("/v1/manifest");
    expect(unauthorized.status).toBe(401);

    const authorized = await app.request("/v1/manifest", {
      headers: {
        authorization: "Bearer test-token"
      }
    });
    expect(authorized.status).toBe(200);
  });
});
