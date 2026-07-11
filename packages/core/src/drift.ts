import path from "node:path";
import { getManifest } from "./context.js";
import { fileExists, listRepoFiles, safeReadText, sha256 } from "./fs-utils.js";
import type { DriftChange, DriftReport, DriftSeverity, Manifest } from "./types.js";

const SEVERITY_ORDER: DriftSeverity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical"
];

function maxSeverity(a: DriftSeverity, b: DriftSeverity): DriftSeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

function summarize(changes: DriftChange[]) {
  const bySeverity: Record<DriftSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  };
  for (const change of changes) {
    bySeverity[change.severity] += 1;
  }
  return {
    total_changes: changes.length,
    by_severity: bySeverity
  };
}

async function collectCurrentSignals(repoPath: string): Promise<{
  fileTreeDigest: string;
  readmeDigest: string;
  directDependencies: string[];
  authPaths: string[];
  authDigest: string;
  dependencyDigest: string;
}> {
  const files = await listRepoFiles(repoPath);
  const fileTreeDigest = sha256(files.join("\n"));

  const readmeCandidates = files.filter((p) =>
    /^readme(\.|$)/i.test(path.basename(p))
  );
  const readmePath = readmeCandidates[0] ?? "README.md";
  const readmeContent = await safeReadText(path.join(repoPath, readmePath));
  const readmeDigest = sha256(readmeContent);

  const packagePath = path.join(repoPath, "package.json");
  let directDependencies: string[] = [];
  if (await fileExists(packagePath)) {
    try {
      const parsed = JSON.parse(await safeReadText(packagePath)) as {
        dependencies?: Record<string, string>;
      };
      directDependencies = Object.keys(parsed.dependencies ?? {}).sort();
    } catch {
      directDependencies = [];
    }
  }

  const authPaths = files.filter((file) =>
    /(auth|oauth|session|login|jwt|token|rbac|acl)/i.test(file)
  );

  return {
    fileTreeDigest,
    readmeDigest,
    directDependencies,
    authPaths,
    authDigest: sha256(authPaths.join("\n")),
    dependencyDigest: sha256(directDependencies.join("\n"))
  };
}

function readAdapterDigest(
  manifest: Manifest,
  candidates: string[]
): string | undefined {
  for (const candidate of candidates) {
    const entry = manifest.adapters[candidate];
    if (entry?.digest) {
      return entry.digest;
    }
  }
  return undefined;
}

function readAdapterList(
  manifest: Manifest,
  candidates: string[],
  key: "direct" | "deps" | "paths"
): string[] {
  for (const candidate of candidates) {
    const entry = manifest.adapters[candidate];
    const value = entry?.[key];
    if (Array.isArray(value)) {
      return [...value].sort();
    }
  }
  return [];
}

function collectManifestChanges(
  manifest: Manifest,
  current: Awaited<ReturnType<typeof collectCurrentSignals>>
): DriftChange[] {
  const changes: DriftChange[] = [];

  const schemaVersion = manifest.schema_version;
  if (!schemaVersion.startsWith("1.")) {
    changes.push({
      kind: "manifest.schema_mismatch",
      severity: "high",
      detail: `manifest schema ${schemaVersion} is incompatible with drift engine`
    });
  }

  const previousFileTreeDigest =
    readAdapterDigest(manifest, ["git", "file_tree"]) ?? manifest.content_hash;
  if (previousFileTreeDigest && previousFileTreeDigest !== current.fileTreeDigest) {
    changes.push({
      kind: "file_tree.digest_changed",
      severity: "info",
      detail: "file tree digest changed",
      before: previousFileTreeDigest,
      after: current.fileTreeDigest
    });
  }

  const previousReadmeDigest = readAdapterDigest(manifest, ["readme", "git_readme"]);
  if (previousReadmeDigest && previousReadmeDigest !== current.readmeDigest) {
    changes.push({
      kind: "readme.changed",
      severity: "medium",
      detail: "README digest changed",
      before: previousReadmeDigest,
      after: current.readmeDigest
    });
  }

  const previousDependencies = readAdapterList(manifest, ["dependencies", "deps"], "direct");
  if (previousDependencies.length > 0) {
    const previous = new Set(previousDependencies);
    const newlyAdded = current.directDependencies.filter((dep) => !previous.has(dep));
    for (const dep of newlyAdded) {
      changes.push({
        kind: "dependency.added",
        severity: "medium",
        detail: `new direct dependency detected: ${dep}`
      });
    }
  } else {
    const previousDepsDigest = readAdapterDigest(manifest, ["dependencies", "deps"]);
    if (previousDepsDigest && previousDepsDigest !== current.dependencyDigest) {
      changes.push({
        kind: "dependency.digest_changed",
        severity: "low",
        detail: "dependency digest changed",
        before: previousDepsDigest,
        after: current.dependencyDigest
      });
    }
  }

  const previousAuthPaths = readAdapterList(
    manifest,
    ["auth_paths", "auth"],
    "paths"
  );
  if (previousAuthPaths.length > 0) {
    const previous = new Set(previousAuthPaths);
    const currentSet = new Set(current.authPaths);
    const added = current.authPaths.filter((p) => !previous.has(p));
    const removed = previousAuthPaths.filter((p) => !currentSet.has(p));

    if (added.length > 0 || removed.length > 0) {
      const details = [
        added.length > 0 ? `added: ${added.join(", ")}` : "",
        removed.length > 0 ? `removed: ${removed.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join(" | ");
      changes.push({
        kind: "auth_paths.changed",
        severity: "high",
        detail: `auth path set changed (${details})`
      });
    }
  } else {
    const previousAuthDigest = readAdapterDigest(manifest, ["auth_paths", "auth"]);
    if (previousAuthDigest && previousAuthDigest !== current.authDigest) {
      changes.push({
        kind: "auth_paths.changed",
        severity: "high",
        detail: "auth path digest changed",
        before: previousAuthDigest,
        after: current.authDigest
      });
    }
  }

  return changes;
}

export async function detectDrift(repoPath: string): Promise<DriftReport> {
  const current = await collectCurrentSignals(repoPath);
  const manifestPath = path.join(repoPath, ".axicontext", "manifest.json");

  let changes: DriftChange[] = [];
  if (!(await fileExists(manifestPath))) {
    changes = [
      {
        kind: "manifest.missing",
        severity: "critical",
        detail: "manifest is missing; run axictx sync"
      }
    ];
  } else {
    const manifest = await getManifest(repoPath);
    changes = collectManifestChanges(manifest, current);
  }

  let severity: DriftSeverity = "info";
  for (const change of changes) {
    severity = maxSeverity(severity, change.severity);
  }

  return {
    status: changes.length > 0 ? "drift" : "ok",
    severity,
    generated_at: new Date().toISOString(),
    changes,
    summary: summarize(changes)
  };
}

export function formatDriftMarkdown(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`# AxiContext Drift Report`);
  lines.push("");
  lines.push(`- status: **${report.status}**`);
  lines.push(`- severity: **${report.severity}**`);
  lines.push(`- generated_at: \`${report.generated_at}\``);
  lines.push(`- total_changes: ${report.summary.total_changes}`);
  lines.push("");

  if (report.changes.length === 0) {
    lines.push("No drift detected.");
    return lines.join("\n");
  }

  lines.push("## Changes");
  for (const change of report.changes) {
    lines.push(
      `- [${change.severity}] \`${change.kind}\` — ${change.detail}${
        change.path ? ` (${change.path})` : ""
      }`
    );
  }

  return lines.join("\n");
}

export function formatDriftGithubAnnotations(report: DriftReport): string[] {
  const levelMap: Record<DriftSeverity, "notice" | "warning" | "error"> = {
    info: "notice",
    low: "warning",
    medium: "warning",
    high: "error",
    critical: "error"
  };

  return report.changes.map((change) => {
    const level = levelMap[change.severity];
    const location = change.path ? `file=${change.path},` : "";
    return `::${level} ${location}title=AxiContext Drift::[${change.severity}] ${change.kind} - ${change.detail}`;
  });
}

export function shouldFailOnDrift(report: DriftReport): boolean {
  return report.changes.length > 0;
}
