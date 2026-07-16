import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_TOML } from "../src/constants.js";
import { ConfigValidationError, loadAxiConfig, parseAxiContextConfigToml } from "../src/config.js";

const tempRoots: string[] = [];

afterEach(() => {
  delete process.env.AXICTX_API_TOKEN;
  delete process.env.AXICTX_SERVE_HOST;
  delete process.env.AXICTX_SERVE_PORT;
  delete process.env.AXICTX_CONFIG;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("parseAxiContextConfigToml", () => {
  it("parses the default config", () => {
    const config = parseAxiContextConfigToml(DEFAULT_CONFIG_TOML);

    expect(config.schema_version).toBe("1.0.0");
    expect(config.serve.port).toBe(8787);
    expect(config.serve.api_token).toBe("");
    expect(config.query).toEqual({ max_tokens_default: 4000, embeddings: "off" });
    expect(config.policy.redact_patterns).toEqual(["default"]);
    expect(config.project_context.max_chars).toBeLessThanOrEqual(500_000);
    expect(config.adapters.git.enabled).toBe(true);
    expect(config.adapters.git.max_excerpt_files).toBe(50);
    expect(config.adapters.github_issues.enabled).toBe(false);
  });

  it("throws a config validation error on invalid schema", () => {
    const invalidToml = `
schema_version = "1.0.0"
[project]
name = "demo"
default_branch = "main"
[project_context]
path = "PROJECT_CONTEXT.md"
commit = true
max_chars = -1
[serve]
host = "127.0.0.1"
port = 8787
[drift]
fail_on = ["high"]
[adapters.git]
enabled = true
[adapters.github_issues]
enabled = false
`;

    expect(() => parseAxiContextConfigToml(invalidToml)).toThrow(ConfigValidationError);
  });

  it("rejects unknown schema versions", () => {
    expect(() => parseAxiContextConfigToml(DEFAULT_CONFIG_TOML.replace('"1.0.0"', '"2.0.0"'))).toThrow(
      ConfigValidationError,
    );
  });

  it("passes file and env api tokens through loadAxiConfig", async () => {
    const root = mkdtempSync(join(tmpdir(), "axictx-config-"));
    tempRoots.push(root);
    const configPath = join(root, "config.toml");
    writeFileSync(configPath, DEFAULT_CONFIG_TOML.replace('api_token = ""', 'api_token = "from-file"'), "utf8");
    process.env.AXICTX_CONFIG = configPath;

    await expect(loadAxiConfig(root)).resolves.toMatchObject({
      serve: { api_token: "from-file" },
      query: { max_tokens_default: 4000, embeddings: "off" },
    });

    process.env.AXICTX_API_TOKEN = "from-env";
    process.env.AXICTX_SERVE_HOST = "localhost";
    process.env.AXICTX_SERVE_PORT = "9999";
    await expect(loadAxiConfig(root)).resolves.toMatchObject({
      serve: { host: "localhost", port: 9999, api_token: "from-env" },
    });
  });
});
