import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeRepo } from "../packages/parsers/src/index.js";
import { generateComposeOverlay, inferSetupPlan } from "../packages/fence-core/src/index.js";

describe("AxiFence compose generation", () => {
  it("includes postgres from the compose fixture in the generated overlay", async () => {
    const repoPath = path.resolve("testdata/fixtures/compose-node-repo");
    const analysis = await analyzeRepo(repoPath);
    const plan = inferSetupPlan(analysis);
    const compose = generateComposeOverlay(plan);

    expect(compose).not.toBeNull();
    expect(compose).toContain("postgres:");
    expect(compose).toContain('image: "postgres:16"');
    expect(compose).toContain('"5432:5432"');
  });
});
