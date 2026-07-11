import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_TOML } from "../src/constants.js";
import { ConfigValidationError, parseAxiContextConfigToml } from "../src/config.js";

describe("parseAxiContextConfigToml", () => {
  it("parses the default config", () => {
    const config = parseAxiContextConfigToml(DEFAULT_CONFIG_TOML);

    expect(config.schema_version).toBe("1.0.0");
    expect(config.serve.port).toBe(8787);
    expect(config.adapters.git.enabled).toBe(true);
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
});
