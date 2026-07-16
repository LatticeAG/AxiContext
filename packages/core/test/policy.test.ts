import { describe, expect, it } from "vitest";
import type { Edge, Excerpt, Node } from "../src/graph-types.js";
import { applyPolicy, redactText } from "../src/policy.js";

describe("redactText", () => {
  it("redacts default secret patterns with pattern IDs", () => {
    const text = [
      "aws=AKIA1234567890ABCDEF",
      "slack=xoxb-123-secret",
      "github=ghp_1234567890abcdefghij1234567890ABCD",
      "jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      "pem=-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    ].join("\n");

    const result = redactText(text);

    expect(result.text).toContain("[REDACTED:aws_access_key]");
    expect(result.text).toContain("[REDACTED:slack_token]");
    expect(result.text).toContain("[REDACTED:github_token]");
    expect(result.text).toContain("[REDACTED:jwt]");
    expect(result.text).toContain("[REDACTED:pem_block]");
    expect(result.redacted).toBe(true);
  });
});

describe("applyPolicy", () => {
  it("drops denylisted paths and marks nodes when excerpt redaction fires", () => {
    const nodes: Node[] = [
      node("file:src/index.ts", { path: "src/index.ts" }),
      node("file:.env", { path: ".env" }),
    ];
    const edges: Edge[] = [
      {
        id: "edge:kept",
        from_id: "file:src/index.ts",
        to_id: "file:.env",
        type: "references",
        data: {},
      },
    ];
    const excerpts: Excerpt[] = [
      {
        id: "excerpt:kept",
        text: "token ghp_1234567890abcdefghij1234567890ABCD",
        provenance: { adapter: "git", path: "src/index.ts", ingested_at: "2026-01-01T00:00:00.000Z" },
      },
      {
        id: "excerpt:denied",
        text: "secret",
        provenance: { adapter: "git", path: ".env", ingested_at: "2026-01-01T00:00:00.000Z" },
      },
    ];

    const result = applyPolicy(
      { nodes, edges, excerpts },
      { denylist_globs: ["**/.env"], redact_patterns: ["default"] },
    );

    expect(result.nodes.map((entry) => entry.id)).toEqual(["file:src/index.ts"]);
    expect(result.nodes[0]?.data.secret_risk).toBe(true);
    expect(result.edges).toEqual([]);
    expect(result.excerpts).toHaveLength(1);
    expect(result.excerpts[0]?.text).toContain("[REDACTED:github_token]");
    expect(result.denied_paths).toEqual([".env"]);
  });
});

function node(id: string, data: Record<string, unknown>): Node {
  return {
    id,
    type: "file",
    data,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}
