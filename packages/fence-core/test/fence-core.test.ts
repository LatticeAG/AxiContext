import { describe, expect, it } from "vitest";

import {
  generateBootstrap,
  generateComposeOverlay,
  generateDevcontainer,
  generateReadmeSetup,
  inferSetupPlan,
  scoreCheck,
  type RepoAnalysis,
} from "../src/index.js";

describe("axi-fence-core", () => {
  it("infers node setup from lockfiles, engines, scripts, env keys, and dependencies", () => {
    const analysis = mockAnalysis({
      ecosystems: ["node"],
      package_manager: undefined,
      manifests: [
        {
          path: "package.json",
          ecosystem: "node",
          kind: "package.json",
          name: "web",
          dependencies: [
            { name: "express", version: "^4.0.0", kind: "dependency" },
            { name: "next", version: "^15.0.0", kind: "dependency" },
            { name: "pg", version: "^8.0.0", kind: "dependency" },
          ],
          scripts: { "db:migrate": "prisma migrate deploy", dev: "next dev" },
          engines: { node: ">=20" },
        },
      ],
      lockfiles: [{ path: "package-lock.json", package_manager: "npm" }],
      env_examples: [{ path: ".env.example", keys: ["DATABASE_URL", "API_TOKEN"] }],
    });

    const plan = inferSetupPlan(analysis);

    expect(plan.package_manager).toBe("npm");
    expect(plan.runtime).toEqual({
      kind: "node",
      image: "mcr.microsoft.com/devcontainers/javascript-node:20",
      version_label: "node-20",
    });
    expect(plan.install_commands).toEqual(["npm ci"]);
    expect(plan.post_create_commands).toEqual(["npm run db:migrate"]);
    expect(plan.services).toEqual([
      {
        name: "postgres",
        image: "postgres:16",
        port: 5432,
        env: { POSTGRES_DB: "app", POSTGRES_PASSWORD: "postgres", POSTGRES_USER: "postgres" },
      },
    ]);
    expect(plan.forward_ports).toEqual([3000, 5432]);
    expect(plan.env_keys).toEqual(["API_TOKEN", "DATABASE_URL"]);
    expect(plan.digest).toMatch(/^sha256:/);
  });

  it("generates stable artifacts without secret values", () => {
    const analysis = mockAnalysis({
      ecosystems: ["node"],
      manifests: [
        {
          path: "package.json",
          ecosystem: "node",
          kind: "package.json",
          dependencies: [{ name: "redis", version: "^5.0.0", kind: "dependency" }],
          scripts: {},
        },
      ],
      lockfiles: [{ path: "pnpm-lock.yaml", package_manager: "pnpm" }],
      env_examples: [{ path: ".env.example", keys: ["REDIS_URL"] }],
    });

    const plan = inferSetupPlan(analysis);
    const secondPlan = inferSetupPlan(analysis);

    expect(secondPlan.digest).toBe(plan.digest);
    expect(generateDevcontainer(plan)).toContain('"dockerComposeFile": "docker-compose.yml"');
    expect(generateComposeOverlay(plan)).toContain("redis:7");

    const bootstrap = generateBootstrap(plan);
    expect(bootstrap).toContain("pnpm install");
    expect(bootstrap).toContain("REDIS_URL=");
    expect(bootstrap).not.toContain("super-secret");

    const readme = generateReadmeSetup(plan, "0.1.0");
    expect(readme).toContain(plan.digest);
    expect(readme).toContain("axi-fence version");
  });

  it("scores blockers, warnings, and info from locked scoring rules", () => {
    const analysis = mockAnalysis({
      ecosystems: ["node"],
      manifests: [],
      lockfiles: [],
      warnings: ["process.env is referenced in several files"],
    });

    const plan = inferSetupPlan(analysis);
    const report = scoreCheck(plan, analysis, 70);

    expect(report.status).toBe("fail");
    expect(report.score).toBe(25);
    expect(report.blockers.map((item) => item.code)).toEqual(["manifest.missing"]);
    expect(report.warnings.map((item) => item.code)).toEqual(["lockfile.missing"]);
    expect(report.info.map((item) => item.code)).toEqual(["runtime.version_defaulted", "env.example_missing"]);
  });

  it("keeps devcontainer JSON parseable when no compose overlay is needed", () => {
    const analysis = mockAnalysis({
      ecosystems: ["go"],
      manifests: [{ path: "go.mod", ecosystem: "go", kind: "go.mod", dependencies: [] }],
      lockfiles: [],
    });

    const plan = inferSetupPlan(analysis);
    const devcontainer = JSON.parse(generateDevcontainer(plan));

    expect(devcontainer).toMatchObject({
      name: "fixture-repo",
      image: "mcr.microsoft.com/devcontainers/go:1.22",
      remoteUser: "vscode",
    });
    expect(generateComposeOverlay(plan)).toBeNull();
  });
});

function mockAnalysis(overrides: Partial<RepoAnalysis> = {}): RepoAnalysis {
  return {
    schema_version: "1.0.0",
    root: "/tmp/fixture-repo",
    ecosystems: ["node"],
    mixed: false,
    project_name: "fixture-repo",
    manifests: [
      {
        path: "package.json",
        ecosystem: "node",
        kind: "package.json",
        dependencies: [],
        scripts: {},
      },
    ],
    lockfiles: [],
    important_files: [],
    readmes: [],
    dockerfiles: [],
    compose_files: [],
    makefiles: [],
    justfiles: [],
    env_examples: [],
    workflows: [],
    tree: { files: [], digest: "sha256:tree" },
    runtime_hints: {
      node_versions: [],
      python_versions: [],
      rust_editions: [],
      go_versions: [],
      docker_base_images: [],
      exposed_ports: [],
    },
    services: [],
    scripts: [],
    warnings: [],
    digest: "sha256:analysis",
    ...overrides,
  };
}
