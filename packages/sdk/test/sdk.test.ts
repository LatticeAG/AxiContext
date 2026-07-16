import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { AxiContext, DEFAULT_CONFIG_TOML } from "../src/index.js";

const execFile = promisify(execFileCallback);
const tmpDirs: string[] = [];
const fixtureRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../testdata/fixtures/minimal-node-repo",
);

async function createFixtureRepo(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "axictx-sdk-"));
  tmpDirs.push(repoRoot);
  await cp(fixtureRoot, repoRoot, { recursive: true });
  await mkdir(path.join(repoRoot, ".axicontext"), { recursive: true });
  await writeFile(path.join(repoRoot, ".axicontext", "config.toml"), DEFAULT_CONFIG_TOML, "utf8");
  await execFile("git", ["-C", repoRoot, "init", "-b", "main"]);
  await execFile("git", ["-C", repoRoot, "config", "user.email", "fixture@example.com"]);
  await execFile("git", ["-C", repoRoot, "config", "user.name", "Fixture Bot"]);
  await execFile("git", ["-C", repoRoot, "config", "commit.gpgsign", "false"]);
  await execFile("git", ["-C", repoRoot, "add", "."]);
  await execFile("git", ["-C", repoRoot, "commit", "--no-gpg-sign", "-m", "initial fixture commit"]);
  return repoRoot;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AxiContext SDK", () => {
  it("runs local sync with the default git adapter", async () => {
    const repoRoot = await createFixtureRepo();
    const context = await AxiContext.fromRepo(repoRoot);

    const syncResult = await context.sync({ maxChars: 5_000 });
    expect(syncResult.manifest.adapters.git.digest).toMatch(/^sha256:/);

    const manifest = await context.getManifest();
    expect(manifest.schema_version).toBe("1.0.0");

    const slice = await context.slice({ topic: "README", maxTokens: 1_000 });
    expect(slice.topic).toBe("README");
    expect(Array.isArray(slice.nodes)).toBe(true);

    const query = await context.query({ question: "What does this fixture validate?", maxTokens: 1_000 });
    expect(query.question).toContain("fixture");
  }, 20_000);
});
