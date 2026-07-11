export interface CoreClientOptions {
  endpoint?: string;
}

export class AxiContextCoreClient {
  private readonly endpoint: string;

  constructor(options: CoreClientOptions = {}) {
    this.endpoint = options.endpoint ?? "http://127.0.0.1:8787";
  }

  async healthcheck(): Promise<{ ok: boolean; endpoint: string }> {
    return { ok: true, endpoint: this.endpoint };
  }
}
