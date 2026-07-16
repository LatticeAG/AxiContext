import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CheckReport } from "@latticeag/axi-fence-core";

import { badgeForReport, ExitCode, runGenerate } from "../src/axi-fence-cli.js";

describe("axi-fence CLI helpers", () => {
  it("refuses to overwrite generated files without --overwrite", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "axi-fence-cli-overwrite-"));

    try {
      await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({ name: "overwrite-fixture" }, null, 2));
      await mkdir(path.join(tempRoot, ".devcontainer"), { recursive: true });
      await writeFile(path.join(tempRoot, ".devcontainer/devcontainer.json"), "{}\n");

      await expect(
        runGenerate(tempRoot, {
          overwrite: false,
          dryRun: false,
          docker: true,
          allowReadmeCommands: false,
          json: false,
        }),
      ).rejects.toMatchObject({
        exitCode: ExitCode.Config,
        message: "Refusing to overwrite .devcontainer/devcontainer.json; pass --overwrite to replace it.",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("formats badge color and label from check status and score", () => {
    const pass = badgeForReport(mockReport({ status: "pass", score: 92 }));
    const fail = badgeForReport(mockReport({ status: "fail", score: 64 }));

    expect(pass).toMatchObject({ color: "green", label: "pass-92" });
    expect(pass.markdown).toContain("AxiFence-pass-92-green");
    expect(fail).toMatchObject({ color: "red", label: "fail-64" });
    expect(fail.markdown).toContain("AxiFence-fail-64-red");
  });
});

function mockReport(overrides: Partial<CheckReport>): CheckReport {
  return {
    schema_version: "1.0.0",
    status: "pass",
    score: 100,
    blockers: [],
    warnings: [],
    info: [],
    plan_digest: "sha256:test",
    generated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
