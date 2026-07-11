import path from "node:path";
import { createServer } from "node:net";
import {
  detectDrift,
  getContextPage,
  getContextSlice,
  getManifest,
  queryContext,
  type DriftReport,
  type Manifest,
  type QueryRequest,
  type QueryResult,
  type SliceRequest
} from "@latticeag/axicontext-core";
import { startAxiContextServer } from "@latticeag/axicontext-server";

interface AxiContextCreateOptions {
  baseUrl?: string;
  spawnServer?: boolean;
  host?: string;
  port?: number;
  apiToken?: string;
}

type Mode = "in-process" | "http";

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(port);
        });
      } else {
        server.close();
        reject(new Error("failed to acquire ephemeral port"));
      }
    });
    server.on("error", reject);
  });
}

async function httpJson<T>(
  url: string,
  init?: RequestInit,
  apiToken?: string
): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (apiToken) {
    headers.set("authorization", `Bearer ${apiToken}`);
  }

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

export class AxiContext {
  private constructor(
    private readonly repoPath: string,
    private readonly mode: Mode,
    private readonly baseUrl?: string,
    private readonly apiToken?: string,
    private readonly stopServer?: () => Promise<void>
  ) {}

  static async fromRepo(
    repoPath: string,
    options: AxiContextCreateOptions = {}
  ): Promise<AxiContext> {
    const resolvedRepoPath = path.resolve(repoPath);

    if (options.baseUrl) {
      return new AxiContext(
        resolvedRepoPath,
        "http",
        options.baseUrl.replace(/\/+$/, ""),
        options.apiToken
      );
    }

    if (options.spawnServer) {
      const port = options.port ?? (await findFreePort());
      const server = await startAxiContextServer({
        repoPath: resolvedRepoPath,
        host: options.host ?? "127.0.0.1",
        port,
        apiToken: options.apiToken
      });
      return new AxiContext(
        resolvedRepoPath,
        "http",
        server.url.replace(/\/+$/, ""),
        options.apiToken,
        server.close
      );
    }

    return new AxiContext(resolvedRepoPath, "in-process");
  }

  async context(cursor?: string, limit?: number) {
    if (this.mode === "http") {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (typeof limit === "number") params.set("limit", String(limit));
      return await httpJson(
        `${this.baseUrl}/v1/context${params.toString() ? `?${params}` : ""}`,
        undefined,
        this.apiToken
      );
    }
    return await getContextPage(this.repoPath, { cursor, limit });
  }

  async manifest(): Promise<Manifest> {
    if (this.mode === "http") {
      return await httpJson(`${this.baseUrl}/v1/manifest`, undefined, this.apiToken);
    }
    return await getManifest(this.repoPath);
  }

  async slice(request: SliceRequest) {
    if (this.mode === "http") {
      const params = new URLSearchParams({
        topic: request.topic,
        depth: String(request.depth ?? 2),
        max_tokens: String(request.max_tokens ?? 2000)
      });
      return await httpJson(
        `${this.baseUrl}/v1/context/slice?${params.toString()}`,
        undefined,
        this.apiToken
      );
    }
    return await getContextSlice(this.repoPath, request);
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    if (this.mode === "http") {
      return await httpJson(
        `${this.baseUrl}/v1/context/query`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request)
        },
        this.apiToken
      );
    }
    return await queryContext(this.repoPath, request);
  }

  async drift(): Promise<DriftReport> {
    if (this.mode === "http") {
      return await httpJson(`${this.baseUrl}/v1/drift`, undefined, this.apiToken);
    }
    return await detectDrift(this.repoPath);
  }

  async close(): Promise<void> {
    if (this.stopServer) {
      await this.stopServer();
    }
  }
}
export {
  AxiContextCoreClient as AxiContextClient,
  type CoreClientOptions as AxiContextClientOptions,
} from "@latticeag/axicontext-core";

export * from "@latticeag/axicontext-core";
