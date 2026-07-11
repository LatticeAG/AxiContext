import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  detectDrift,
  getContextPage,
  getContextSlice,
  getManifest,
  loadAxiConfig,
  queryContext
} from "@latticeag/axicontext-core";

export interface ServerOptions {
  repoPath?: string;
  host?: string;
  port?: number;
  apiToken?: string;
}

function buildOpenApi(host: string, port: number) {
  return {
    openapi: "3.1.0",
    info: {
      title: "AxiContext Agent Read API",
      version: "1.0.0"
    },
    servers: [{ url: `http://${host}:${port}` }],
    paths: {
      "/healthz": { get: { summary: "Health check", responses: { 200: { description: "OK" } } } },
      "/v1/manifest": { get: { summary: "Read context manifest" } },
      "/v1/context": { get: { summary: "Read graph summary + manifest" } },
      "/v1/context/slice": { get: { summary: "Read topic slice from context graph" } },
      "/v1/context/query": { post: { summary: "Query graph excerpts" } },
      "/v1/drift": { get: { summary: "Read drift report" } },
      "/v1/openapi.json": { get: { summary: "Read OpenAPI spec" } }
    }
  };
}

function tokenFromRequest(request: Request): string | null {
  const bearer = request.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice("bearer ".length).trim();
  }
  return request.headers.get("x-api-token");
}

export function createAxiContextApp(options: {
  repoPath: string;
  host: string;
  port: number;
  apiToken?: string;
}) {
  const app = new Hono();
  const openApi = buildOpenApi(options.host, options.port);

  app.use("/v1/*", async (c, next) => {
    if (!options.apiToken) {
      await next();
      return;
    }

    const token = tokenFromRequest(c.req.raw);
    if (token !== options.apiToken) {
      throw new HTTPException(401, { message: "invalid api token" });
    }
    await next();
  });

  app.get("/healthz", (c) => {
    return c.json({
      status: "ok",
      host: options.host,
      repo_path: options.repoPath
    });
  });

  app.get("/v1/manifest", async (c) => {
    const manifest = await getManifest(options.repoPath);
    return c.json(manifest);
  });

  app.get("/v1/context", async (c) => {
    const cursor = c.req.query("cursor");
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const page = await getContextPage(options.repoPath, { cursor, limit });
    return c.json(page);
  });

  app.get("/v1/context/slice", async (c) => {
    const topic = c.req.query("topic") ?? "";
    const depth = Number(c.req.query("depth") ?? "2");
    const maxTokens = Number(c.req.query("max_tokens") ?? "2000");
    const slice = await getContextSlice(options.repoPath, {
      topic,
      depth: Number.isFinite(depth) ? depth : 2,
      max_tokens: Number.isFinite(maxTokens) ? maxTokens : 2000
    });
    return c.json(slice);
  });

  app.post("/v1/context/query", async (c) => {
    const body = await c.req.json();
    const question = String(body.question ?? "");
    if (!question.trim()) {
      throw new HTTPException(400, { message: "question is required" });
    }

    const result = await queryContext(options.repoPath, {
      question,
      max_tokens:
        typeof body.max_tokens === "number" && Number.isFinite(body.max_tokens)
          ? body.max_tokens
          : undefined,
      include: Array.isArray(body.include) ? body.include : undefined
    });
    return c.json(result);
  });

  app.get("/v1/drift", async (c) => {
    const report = await detectDrift(options.repoPath);
    return c.json(report);
  });

  app.get("/v1/openapi.json", (c) => c.json(openApi));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    return c.json({ error: "internal_server_error", detail: String(err) }, 500);
  });

  return app;
}

export async function resolveServerOptions(
  options: ServerOptions = {}
): Promise<Required<Pick<ServerOptions, "repoPath" | "host" | "port">> & {
  apiToken?: string;
}> {
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  const config = await loadAxiConfig(repoPath);
  return {
    repoPath,
    host: options.host ?? config.serve.host ?? "127.0.0.1",
    port: options.port ?? config.serve.port ?? 8787,
    apiToken: options.apiToken ?? config.serve.api_token ?? undefined
  };
}

export async function startAxiContextServer(options: ServerOptions = {}) {
  const resolved = await resolveServerOptions(options);
  const app = createAxiContextApp({
    repoPath: resolved.repoPath,
    host: resolved.host,
    port: resolved.port,
    apiToken: resolved.apiToken
  });
  const server = serve({
    fetch: app.fetch,
    hostname: resolved.host,
    port: resolved.port
  });

  return {
    app,
    server,
    url: `http://${resolved.host}:${resolved.port}`,
    options: resolved,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      })
  };
}
