import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_TOML, GraphStore } from "@latticeag/axicontext-core";
import { createAxiContextApp, startAxiContextServer } from "@latticeag/axicontext-server";

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
  await writeFile(path.join(repoPath, ".axicontext", "config.toml"), DEFAULT_CONFIG_TOML, "utf8");

  const store = GraphStore.open(repoPath);
  store.upsertNode({
    id: "project:fixture",
    type: "project",
    data: { name: "fixture" }
  });
  store.upsertNode({
    id: "file:src/auth/login.ts",
    type: "file",
    data: { path: "src/auth/login.ts", role: "important" }
  });
  store.upsertEdge({
    id: "edge:project-login",
    from_id: "project:fixture",
    to_id: "file:src/auth/login.ts",
    type: "contains",
    data: {}
  });
  store.addExcerpt({
    text: "OAuth details live in src/auth/login.ts.",
    provenance: {
      adapter: "git",
      path: "src/auth/login.ts",
      start_line: 1,
      end_line: 1,
      ingested_at: "2026-07-11T00:00:00.000Z"
    }
  });
  store.writeManifest({
    git: {
      digest: "sha256:any",
      stats: { files_considered: 1 }
    }
  });
  store.close();

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
    const etag = manifest.headers.get("etag");
    expect(etag).toMatch(/^"sha256:/);
    const manifestJson = await manifest.json();
    expect(manifestJson.schema_version).toBe("1.0.0");

    const cachedManifest = await app.request("/v1/manifest", {
      headers: {
        "if-none-match": etag ?? ""
      }
    });
    expect(cachedManifest.status).toBe(304);

    const context = await app.request("/v1/context?limit=1");
    expect(context.status).toBe(200);
    const contextJson = await context.json();
    expect(contextJson.manifest.schema_version).toBe("1.0.0");
    expect(Array.isArray(contextJson.nodes)).toBe(true);
    expect(contextJson.nodes.length).toBeLessThanOrEqual(1);
    expect(contextJson.next_cursor).toBe("1");

    const cachedContext = await app.request("/v1/context", {
      headers: {
        "if-none-match": etag ?? ""
      }
    });
    expect(cachedContext.status).toBe(304);

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
        question: "Where are OAuth details?",
        max_tokens: 1200
      })
    });
    expect(query.status).toBe(200);
    const queryJson = await query.json();
    expect(Array.isArray(queryJson.answer_context)).toBe(true);
    expect(queryJson.tokens_used).toBeGreaterThan(0);
    expect(queryJson.answer_context[0]?.provenance.path).toBe("src/auth/login.ts");

    const drift = await app.request("/v1/drift");
    expect(drift.status).toBe(200);
    const driftJson = await drift.json();
    expect(["ok", "drift"]).toContain(driftJson.status);

    const openApi = await app.request("/v1/openapi.json");
    expect(openApi.status).toBe(200);
    const openApiJson = await openApi.json();
    expect(openApiJson.paths["/v1/context/query"]).toBeDefined();
    expect(openApiJson.components.securitySchemes.bearerAuth).toBeDefined();
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

  it("returns 404 for missing manifests", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "axictx-server-missing-"));
    tmpDirs.push(repoPath);
    await mkdir(path.join(repoPath, ".axicontext"), { recursive: true });
    const app = createAxiContextApp({
      repoPath,
      host: "127.0.0.1",
      port: 8787
    });

    const manifest = await app.request("/v1/manifest");
    expect(manifest.status).toBe(404);
    await expect(manifest.json()).resolves.toEqual({
      error: "manifest_missing",
      hint: "run axictx sync"
    });
  });

  it("refuses to start on a non-loopback host without a token", async () => {
    const repoPath = await makeRepoFixture();

    await expect(
      startAxiContextServer({
        repoPath,
        host: "0.0.0.0",
        port: 8787,
        apiToken: ""
      })
    ).rejects.toThrow("Refusing to start without an API token");
  });
});
