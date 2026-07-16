import type { RepoAnalysis, ServiceHint } from "@latticeag/axicontext-parsers";

import type { CheckItem, CheckReport, SetupPlan } from "./types.js";

export function scoreCheck(plan: SetupPlan, analysis: RepoAnalysis, minScore = 70): CheckReport {
  const blockers: CheckItem[] = [];
  const warnings: CheckItem[] = [];
  const info: CheckItem[] = [];
  let score = 100;

  if (analysis.manifests.length === 0) {
    score -= 50;
    blockers.push({
      code: "manifest.missing",
      message: "No package manifest was detected.",
    });
  }

  for (const warning of analysis.warnings) {
    if (/manifest|package\.json|pyproject\.toml|Cargo\.toml|go\.mod/i.test(warning) && /parse|unparsable|invalid/i.test(warning)) {
      score -= 40;
      blockers.push({
        code: "manifest.unparsable",
        message: warning,
      });
    }
  }

  if (lockfileMissing(analysis)) {
    score -= 15;
    warnings.push({
      code: "lockfile.missing",
      message: "A lockfile was expected for the detected Node or Python setup.",
    });
  }

  if (plan.runtime.version_label.startsWith("default-")) {
    score -= 5;
    info.push({
      code: "runtime.version_defaulted",
      message: "Runtime version was not pinned, so AxiFence selected the default image.",
    });
  }

  const unknownServices = analysis.services.filter(isUnknownService);
  if (unknownServices.length > 0) {
    score -= 20;
    warnings.push({
      code: "services.unknown",
      message: "Services were detected, but one or more could not be converted into a compose service.",
    });
  }

  if (envExampleMissingWithHeavyEnvUse(analysis)) {
    score -= 5;
    info.push({
      code: "env.example_missing",
      message: "The repo appears to reference environment variables but has no .env example file.",
    });
  }

  if (multipleEcosystemsWithoutWorkspaceTooling(analysis)) {
    score -= 10;
    warnings.push({
      code: "workspace.tooling_missing",
      message: "Multiple ecosystems were detected without workspace tooling signals.",
    });
  }

  const flooredScore = Math.max(0, score);
  const status = blockers.length === 0 && flooredScore >= minScore ? "pass" : "fail";

  return {
    schema_version: "1.0.0",
    status,
    score: flooredScore,
    blockers,
    warnings,
    info,
    plan_digest: plan.digest,
    generated_at: new Date().toISOString(),
  };
}

function lockfileMissing(analysis: RepoAnalysis): boolean {
  const ecosystems = new Set(analysis.ecosystems);
  const lockfilePaths = analysis.lockfiles.map((lockfile) => lockfile.path);

  if (ecosystems.has("node") || analysis.manifests.some((manifest) => manifest.path.endsWith("package.json"))) {
    return !lockfilePaths.some((path) =>
      ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "package-lock.json"].some((filename) =>
        path.endsWith(filename),
      ),
    );
  }

  if (ecosystems.has("python") || analysis.manifests.some((manifest) => manifest.path.endsWith("pyproject.toml"))) {
    const usesLockingManager = analysis.package_manager === "poetry" || analysis.package_manager === "uv";
    return usesLockingManager && !lockfilePaths.some((path) => path.endsWith("poetry.lock") || path.endsWith("uv.lock"));
  }

  return false;
}

function isUnknownService(service: ServiceHint): boolean {
  return Boolean(!service.name || !service.image || service.ports.length === 0);
}

function envExampleMissingWithHeavyEnvUse(analysis: RepoAnalysis): boolean {
  if (analysis.env_examples.length > 0) {
    return false;
  }

  return analysis.warnings.some((warning) => /process\.env|environment variable/i.test(warning));
}

function multipleEcosystemsWithoutWorkspaceTooling(analysis: RepoAnalysis): boolean {
  const ecosystems = new Set(analysis.ecosystems.filter((ecosystem) => ecosystem !== "unknown"));
  if (ecosystems.size < 2) {
    return false;
  }

  return !analysis.manifests.some((manifest) => Boolean(manifest.workspaces) || manifest.path.includes("pnpm-workspace.yaml"));
}
