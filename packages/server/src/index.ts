import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  detectDrift,
  getContextPage,
  getContextSlice,
  loadManifest,
  loadAxiConfig,
  queryContext
} from "@latticeag/axicontext-core";

const AXICTX_VERSION = "0.1.0";

export interface ServerOptions {
  repoPath?: string;
  host?: string;
  port?: number;
  apiToken?: string;
}

function buildOpenApi(host: string, port: number) {
  const unauthorized = { description: "Missing or invalid API token" };
  const manifestResponse = {
    description: "Manifest",
    headers: {
      ETag: {
        schema: { type: "string" }
      }
    }
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "AxiContext Agent Read API",
      version: "1.0.0"
    },
    servers: [{ url: `http://${host}:${port}` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer"
        },
        apiToken: {
          type: "apiKey",
          in: "header",
          name: "X-API-Token"
        }
      }
    },
    paths: {
      "/healthz": {
        get: {
          summary: "Health check",
          responses: { 200: { description: "OK" } }
        }
      },
      "/v1/manifest": {
        get: {
          summary: "Read context manifest",
          security: [{ bearerAuth: [] }, { apiToken: [] }],
          responses: { 200: manifestResponse, 401: unauthorized, 404: { description: "Manifest missing" } }
        }
      },
      "/v1/context": {
        get: {
          summary: "Read paginated graph nodes and manifest",
          security: [{ bearerAuth: [] }, { apiToken: [] }],
          parameters: [
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 100, minimum: 1, maximum: 200 } }
          ],
          responses: { 200: manifestResponse, 304: { description: "Not modified" }, 401: unauthorized, 404: { description: "Manifest missing" } }
        }
      },
      "/v1/context/slice": {
        get: {
          summary: "Read topic slice from context graph",
          security: [{ bearerAuth: [] }, { apiToken: [] }]
        }
      },
      "/v1/context/query": {
        post: {
          summary: "Query graph excerpts",
          security: [{ bearerAuth: [] }, { apiToken: [] }]
        }
      },
      "/v1/drift": {
        get: {
          summary: "Read drift report",
          security: [{ bearerAuth: [] }, { apiToken: [] }]
        }
      },
      "/v1/openapi.json": {
        get: {
          summary: "Read OpenAPI spec",
          security: [{ bearerAuth: [] }, { apiToken: [] }]
        }
      }
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

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function etagValue(contentHash: string): string {
  return `"${contentHash}"`;
}

function requestMatchesEtag(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) {
    return false;
  }
  return header
    .split(",")
    .map((entry) => entry.trim())
    .some((entry) => entry === "*" || entry === etag || entry === etag.slice(1, -1));
}

function jsonBodyRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseInclude(value: unknown): Array<"code" | "docs" | "issues" | "manifest"> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set(["code", "docs", "issues", "manifest"]);
  const include = value.filter((entry): entry is "code" | "docs" | "issues" | "manifest" => {
    return typeof entry === "string" && allowed.has(entry);
  });
  return include.length > 0 ? include : undefined;
}

function parseOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorResponse(error: string, code: string, hint?: string): { error: string; hint?: string; code: string } {
  return {
    error,
    ...(hint ? { hint } : {}),
    code
  };
}

export function createAxiContextApp(options: {
  repoPath: string;
  host: string;
  port: number;
  apiToken?: string;
}) {
  const app = new Hono();
  const openApi = buildOpenApi(options.host, options.port);
  const debugRequests = process.env.AXICTX_SERVE_DEBUG === "1";

  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    await next();
    if (debugRequests) {
      process.stderr.write(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - startedAt}ms\n`);
    }
  });

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

  app.get("/healthz", async (c) => {
    const manifest = await loadManifest(options.repoPath);
    return c.json({
      status: "ok",
      axictx_version: manifest?.axictx_version ?? AXICTX_VERSION,
      ...(manifest?.content_hash ? { content_hash: manifest.content_hash } : {}),
      host: options.host,
      repo_path: options.repoPath
    });
  });

  app.get("/v1/manifest", async (c) => {
    const manifest = await loadManifest(options.repoPath);
    if (!manifest) {
      return c.json(errorResponse("manifest_missing", "manifest_missing", "run axictx sync"), 404);
    }
    if (manifest.content_hash) {
      const etag = etagValue(manifest.content_hash);
      c.header("ETag", etag);
      if (requestMatchesEtag(c.req.raw, etag)) {
        return c.body(null, 304);
      }
    }
    return c.json(manifest);
  });

  app.get("/v1/context", async (c) => {
    const manifest = await loadManifest(options.repoPath);
    if (!manifest) {
      return c.json(errorResponse("manifest_missing", "manifest_missing", "run axictx sync"), 404);
    }
    if (manifest.content_hash) {
      const etag = etagValue(manifest.content_hash);
      c.header("ETag", etag);
      if (requestMatchesEtag(c.req.raw, etag)) {
        return c.body(null, 304);
      }
    }
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
    const body = jsonBodyRecord(await c.req.json());
    const question = String(body.question ?? "");
    if (!question.trim()) {
      throw new HTTPException(400, { message: "question is required" });
    }

    const result = await queryContext(options.repoPath, {
      question,
      max_tokens: parseOptionalFiniteNumber(body.max_tokens),
      include: parseInclude(body.include)
    });
    return c.json(result);
  });

  app.get("/v1/drift", async (c) => {
    const report = await detectDrift(options.repoPath);
    return c.json(report);
  });

  app.get("/v1/openapi.json", (c) => c.json(openApi));

  app.notFound((c) => c.json(errorResponse("not_found", "not_found"), 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(errorResponse(err.message, `http_${err.status}`), err.status);
    }
    return c.json(errorResponse("internal_server_error", "internal_server_error"), 500);
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
  if (!resolved.apiToken && !isLoopbackHost(resolved.host)) {
    throw new Error("Refusing to start without an API token on a non-loopback host.");
  }
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
