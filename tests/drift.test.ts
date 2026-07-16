import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectDrift,
  formatDriftMarkdown,
  formatDriftSarif,
  shouldFailOnDrift
} from "@latticeag/axicontext-core";

const tmpDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "axictx-drift-"));
  tmpDirs.push(repoPath);
  await mkdir(path.join(repoPath, ".axicontext"), { recursive: true });
  await mkdir(path.join(repoPath, "src", "auth"), { recursive: true });
  return repoPath;
}

function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("detectDrift", () => {
  it("detects P2 drift kinds and honors fail severities", async () => {
    const repoPath = await makeTempRepo();

    await writeFile(path.join(repoPath, "README.md"), "Updated README body\n", "utf8");
    await writeFile(path.join(repoPath, "PROJECT_CONTEXT.md"), "Updated project context\n", "utf8");
    await writeFile(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          version: "0.0.1",
          dependencies: {
            existing: "1.0.0",
            newdep: "2.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(path.join(repoPath, "src", "auth", "login.ts"), "export const login = true;\n");
    await writeFile(path.join(repoPath, "src", "auth", "session.ts"), "export const session = true;\n");
    await writeFile(path.join(repoPath, "src", "index.ts"), "export const root = true;\n");

    const manifest = {
      schema_version: "1.0.0",
      generated_at: "2026-07-11T00:00:00.000Z",
      project_context_hash: sha256("Old project context\n"),
      adapters: {
        git: { digest: "sha256:old-adapter-digest" },
        file_tree: { digest: "sha256:old-tree-digest" },
        readme: { digest: sha256("Old README body\n") },
        dependencies: { direct: ["existing", "removed"] },
        auth_paths: { paths: ["src/auth/login.ts", "src/auth/removed.ts"] }
      }
    };

    await writeFile(
      path.join(repoPath, ".axicontext", "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const report = await detectDrift(repoPath);
    const kinds = new Set(report.changes.map((change) => change.kind));

    expect(report.status).toBe("drift");
    expect(report.severity).toBe("high");
    expect(kinds.has("adapter.digest.changed")).toBe(true);
    expect(kinds.has("file_tree.changed")).toBe(true);
    expect(kinds.has("readme.changed")).toBe(true);
    expect(kinds.has("dependencies.changed")).toBe(true);
    expect(kinds.has("dependency.added")).toBe(true);
    expect(kinds.has("dependency.removed")).toBe(true);
    expect(kinds.has("auth_paths.changed")).toBe(true);
    expect(kinds.has("project_context_hash.changed")).toBe(true);
    expect(shouldFailOnDrift(report, ["critical"])).toBe(false);
    expect(shouldFailOnDrift(report, ["high"])).toBe(true);

    const markdown = formatDriftMarkdown(report);
    expect(markdown).toContain("AxiContext Drift Report");
    expect(markdown).toContain("dependency.added");

    const sarif = JSON.parse(formatDriftSarif(report)) as {
      version: string;
      runs: Array<{ results: Array<{ ruleId: string }> }>;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results.some((result) => result.ruleId === "auth_paths.changed")).toBe(true);
  });

  it("does not treat a git adapter digest as a file tree digest", async () => {
    const repoPath = await makeTempRepo();
    await writeFile(path.join(repoPath, "README.md"), "README body\n", "utf8");
    await writeFile(path.join(repoPath, "package.json"), JSON.stringify({ name: "fixture" }), "utf8");

    await writeFile(
      path.join(repoPath, ".axicontext", "manifest.json"),
      `${JSON.stringify(
        {
          schema_version: "1.0.0",
          generated_at: "2026-07-11T00:00:00.000Z",
          adapters: {
            git: { digest: "sha256:previous-adapter-digest" }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const report = await detectDrift(repoPath);
    const kinds = new Set(report.changes.map((change) => change.kind));

    expect(kinds.has("adapter.digest.changed")).toBe(true);
    expect(kinds.has("file_tree.changed")).toBe(false);
  });

  it("reports missing manifests as critical drift", async () => {
    const repoPath = await makeTempRepo();
    await rm(path.join(repoPath, ".axicontext", "manifest.json"), { force: true });

    const report = await detectDrift(repoPath);

    expect(report.changes).toEqual([
      expect.objectContaining({
        kind: "manifest.missing",
        severity: "critical"
      })
    ]);
    expect(shouldFailOnDrift(report)).toBe(true);
  });
});
