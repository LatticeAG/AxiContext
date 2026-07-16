import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeRepo } from "../src/index.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const fixtureRoot = path.join(testDir, "fixtures");

describe("analyzeRepo", () => {
  it("analyzes the shared minimal node fixture and produces a stable digest", async () => {
    const fixture = path.join(repoRoot, "testdata/fixtures/minimal-node-repo");

    const first = await analyzeRepo(fixture);
    const second = await analyzeRepo(fixture);

    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.schema_version).toBe("1.0.0");
    expect(first.ecosystems).toEqual(["node"]);
    expect(first.mixed).toBe(false);
    expect(first.project_name).toBe("minimal-node-repo");
    expect(first.package_manager).toBe("npm");
    expect(first.manifests[0]).toMatchObject({
      path: "package.json",
      kind: "package.json",
      ecosystem: "node",
      name: "minimal-node-repo",
    });
    expect(first.lockfiles.map((lockfile) => lockfile.path)).toContain("package-lock.json");
    expect(first.readmes.map((readme) => readme.path)).toContain("README.md");
    expect(first.workflows.map((workflow) => workflow.path)).toContain(".github/workflows/ci.yml");
    expect(first.important_files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["CODEOWNERS", "LICENSE", "SECURITY.md", "docs/README.md", "src/auth/session.ts"]),
    );
  });

  it("keeps the digest stable when repository contents move to another root", async () => {
    const fixture = path.join(repoRoot, "testdata/fixtures/minimal-node-repo");
    const copiedRoot = await mkdtemp(path.join(tmpdir(), "axicontext-parsers-copy-"));

    try {
      await cp(fixture, copiedRoot, { recursive: true });

      const fixtureAnalysis = await analyzeRepo(await realpath(fixture));
      const copiedAnalysis = await analyzeRepo(copiedRoot);

      expect(copiedAnalysis.root).not.toBe(fixtureAnalysis.root);
      expect(copiedAnalysis.digest).toBe(fixtureAnalysis.digest);
      expect(copiedAnalysis.tree.digest).toBe(fixtureAnalysis.tree.digest);
    } finally {
      await rm(copiedRoot, { recursive: true, force: true });
    }
  });

  it("detects runtime version files and packageManager when no lockfile is present", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "axicontext-parsers-runtime-"));

    try {
      await writeFile(
        path.join(tempRoot, "package.json"),
        JSON.stringify({ name: "runtime-hints", packageManager: "pnpm@9.15.0" }, null, 2),
      );
      await writeFile(path.join(tempRoot, ".nvmrc"), "v20.11.1\n");
      await writeFile(path.join(tempRoot, ".node-version"), "22.5.1\n");
      await writeFile(path.join(tempRoot, ".python-version"), "3.12.3\n");
      await writeFile(path.join(tempRoot, ".tool-versions"), "nodejs 21.7.0\npython 3.11.9\ngolang 1.22.4\nrust 1.78.0\n");

      const analysis = await analyzeRepo(tempRoot);

      expect(analysis.package_manager).toBe("pnpm");
      expect(analysis.runtime_hints.node_versions).toEqual(["21.7.0", "22.5.1", "v20.11.1"]);
      expect(analysis.runtime_hints.python_versions).toEqual(["3.11.9", "3.12.3"]);
      expect(analysis.runtime_hints.go_versions).toEqual(["1.22.4"]);
      expect(analysis.runtime_hints.rust_versions).toEqual(["1.78.0"]);
      expect(analysis.runtime_hints.package_manager).toBe("pnpm");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("lets lockfiles win over packageManager", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "axicontext-parsers-package-manager-"));

    try {
      await writeFile(
        path.join(tempRoot, "package.json"),
        JSON.stringify({ name: "lockfile-wins", packageManager: "pnpm@9.15.0" }, null, 2),
      );
      await writeFile(path.join(tempRoot, "package-lock.json"), "{}\n");

      const analysis = await analyzeRepo(tempRoot);

      expect(analysis.manifests[0]?.package_manager).toBe("pnpm@9.15.0");
      expect(analysis.package_manager).toBe("npm");
      expect(analysis.runtime_hints.package_manager).toBe("npm");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("parses pyproject.toml facts and dependency service hints", async () => {
    const analysis = await analyzeRepo(path.join(fixtureRoot, "python"));

    expect(analysis.ecosystems).toEqual(["python"]);
    expect(analysis.project_name).toBe("minimal-python");
    expect(analysis.package_manager).toBe("pip");
    expect(analysis.runtime_hints.python_versions).toEqual([">=3.11"]);
    expect(analysis.manifests[0]?.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "fastapi", version: ">=0.115" }),
        expect.objectContaining({ name: "psycopg", version: ">=3.2" }),
        expect.objectContaining({ name: "pytest", version: ">=8", kind: "optionalDependency" }),
      ]),
    );
    expect(analysis.services).toContainEqual(
      expect.objectContaining({ name: "postgres", kind: "postgres", source: "dependency", ports: [5432] }),
    );
  });

  it("parses Cargo.toml facts", async () => {
    const analysis = await analyzeRepo(path.join(fixtureRoot, "rust"));

    expect(analysis.ecosystems).toEqual(["rust"]);
    expect(analysis.project_name).toBe("minimal-rust");
    expect(analysis.package_manager).toBe("cargo");
    expect(analysis.runtime_hints.rust_editions).toEqual(["2021"]);
    expect(analysis.manifests[0]?.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "tokio", version: "1" }),
        expect.objectContaining({ name: "tempfile", version: "3", kind: "devDependency" }),
      ]),
    );
  });

  it("parses go.mod facts and service hints", async () => {
    const analysis = await analyzeRepo(path.join(fixtureRoot, "go"));

    expect(analysis.ecosystems).toEqual(["go"]);
    expect(analysis.project_name).toBe("github.com/latticeag/minimal-go");
    expect(analysis.package_manager).toBe("go");
    expect(analysis.runtime_hints.go_versions).toEqual(["1.22"]);
    expect(analysis.manifests[0]?.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "github.com/redis/go-redis/v9", version: "v9.7.0" }),
      ]),
    );
    expect(analysis.services).toContainEqual(
      expect.objectContaining({ name: "redis", kind: "redis", source: "dependency", ports: [6379] }),
    );
  });

  it("parses Docker, compose, target files, scripts, and env example keys", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "axicontext-parsers-"));
    await cp(path.join(fixtureRoot, "compose"), tempRoot, { recursive: true });
    await writeFile(path.join(tempRoot, ".env"), "DATABASE_URL=postgres://supersecret@example.invalid/app\n");

    try {
      const analysis = await analyzeRepo(tempRoot);

      expect(analysis.package_manager).toBe("pnpm");
      expect(analysis.dockerfiles[0]).toMatchObject({
        path: "Dockerfile",
        base_images: ["node:22-bookworm"],
        exposed_ports: [3000, 5173],
      });
      expect(analysis.compose_files[0]?.services).toEqual([
        { name: "db", image: "postgres:16", ports: [5432] },
        { name: "redis", image: "redis:7", ports: [6379] },
      ]);
      expect(analysis.makefiles[0]?.targets).toEqual(["migrate", "setup"]);
      expect(analysis.justfiles[0]?.targets).toEqual(["bootstrap", "check"]);
      expect(analysis.env_examples[0]?.keys).toEqual(["DATABASE_URL", "REDIS_URL"]);
      expect(analysis.scripts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "dev", source: "package.json" }),
          expect.objectContaining({ name: "migrate", source: "Makefile" }),
          expect.objectContaining({ name: "bootstrap", source: "Justfile" }),
        ]),
      );
      expect(analysis.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "db", kind: "postgres", source: "compose" }),
          expect.objectContaining({ name: "redis", kind: "redis", source: "compose" }),
          expect.objectContaining({ name: "postgres", kind: "postgres", source: "dependency" }),
        ]),
      );
      expect(JSON.stringify(analysis)).not.toContain("supersecret");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
