import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectDrift, formatDriftMarkdown } from "@latticeag/axicontext-core";

const tmpDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "axictx-drift-"));
  tmpDirs.push(repoPath);
  await mkdir(path.join(repoPath, ".axicontext"), { recursive: true });
  await mkdir(path.join(repoPath, "src", "auth"), { recursive: true });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("detectDrift", () => {
  it("detects tree, readme, dependency, and auth path drift", async () => {
    const repoPath = await makeTempRepo();

    await writeFile(path.join(repoPath, "README.md"), "Updated README body\n", "utf8");
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
      adapters: {
        git: { digest: "sha256:old-tree-digest" },
        readme: { digest: "sha256:old-readme-digest" },
        dependencies: { direct: ["existing"] },
        auth_paths: { paths: ["src/auth/login.ts"] }
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
    expect(kinds.has("file_tree.digest_changed")).toBe(true);
    expect(kinds.has("readme.changed")).toBe(true);
    expect(kinds.has("dependency.added")).toBe(true);
    expect(kinds.has("auth_paths.changed")).toBe(true);

    const markdown = formatDriftMarkdown(report);
    expect(markdown).toContain("AxiContext Drift Report");
    expect(markdown).toContain("dependency.added");
  });
});
