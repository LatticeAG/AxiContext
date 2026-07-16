#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { GitSourceAdapter } from "@latticeag/axicontext-adapter-git";
import {
  AXICONTEXT_DIR,
  CONFIG_FILE_NAME,
  ConfigValidationError,
  ExitCode,
  detectDrift,
  formatDriftGithubAnnotations,
  formatDriftMarkdown,
  getContextSummary,
  getManifest,
  loadAxiConfig,
  loadAxiContextConfig,
  queryContext,
  resolveAxiRepoRoot,
  runSync,
  scaffoldAxiContext,
  shouldFailOnDrift,
} from "@latticeag/axicontext-core";
import type {
  AxiContextConfig,
  DriftReport,
  DriftSeverity,
  SourceAdapter,
} from "@latticeag/axicontext-core";
import { startAxiContextServer } from "@latticeag/axicontext-server";

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

class CliExitError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
    this.name = "CliExitError";
  }
}

function parsePositiveInt(input: string, label = "value"): number {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function nodeVersionIsSupported(version = process.versions.node): boolean {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return Number.isFinite(major) && major >= 22;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pathReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface RepoRootOption {
  repoRoot?: string;
}

function resolveCliRepoRoot(options: RepoRootOption = {}): string {
  return resolveAxiRepoRoot(options.repoRoot);
}

function firstExcerptLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

const ADAPTER_FACTORIES = {
  git: () => new GitSourceAdapter(),
} satisfies Record<string, () => SourceAdapter>;

function parseAdapterCsv(input: string | undefined): string[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  const ids = [
    ...new Set(
      input
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];

  if (ids.length === 0) {
    throw new CliExitError("--adapters must include at least one adapter id", ExitCode.Config);
  }

  return ids;
}

function createAdapters(requestedIds: string[] | undefined): SourceAdapter[] {
  const availableIds = Object.keys(ADAPTER_FACTORIES);
  const ids = requestedIds ?? availableIds;
  const unknownIds = ids.filter((id) => !(id in ADAPTER_FACTORIES));

  if (unknownIds.length > 0) {
    throw new CliExitError(
      `Unknown adapter id(s): ${unknownIds.join(", ")}. Available adapters: ${availableIds.join(", ")}`,
      ExitCode.Config,
    );
  }

  return ids.map((id) => ADAPTER_FACTORIES[id as keyof typeof ADAPTER_FACTORIES]());
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "[0:0:0:0:0:0:0:1]" ||
    normalized.startsWith("127.")
  );
}

function severityIsConfiguredToFail(severity: DriftSeverity, config: AxiContextConfig): boolean {
  switch (severity) {
    case "info":
      return false;
    case "low":
      return config.drift.fail_on.includes("low");
    case "medium":
      return config.drift.fail_on.includes("medium");
    case "high":
      return config.drift.fail_on.includes("high");
    case "critical":
      return config.drift.fail_on.includes("critical");
  }
}

function shouldExitForDrift(report: DriftReport, config: AxiContextConfig): boolean {
  return shouldFailOnDrift(report) && report.changes.some((change) => severityIsConfiguredToFail(change.severity, config));
}

function driftLevel(severity: DriftSeverity): "note" | "warning" | "error" {
  if (severity === "info") {
    return "note";
  }
  if (severity === "low" || severity === "medium") {
    return "warning";
  }
  return "error";
}

function formatDriftSarif(report: DriftReport): object {
  const ruleIds = [...new Set(report.changes.map((change) => change.kind))].sort();
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "axictx",
            informationUri: "https://github.com/LatticeAG/AxiContext",
            rules: ruleIds.map((id) => ({
              id,
              name: id,
              shortDescription: { text: "AxiContext drift check" },
            })),
          },
        },
        results: report.changes.map((change) => ({
          ruleId: change.kind,
          level: driftLevel(change.severity),
          message: { text: `[${change.severity}] ${change.detail}` },
          locations: change.path
            ? [
                {
                  physicalLocation: {
                    artifactLocation: { uri: change.path },
                    region: { startLine: 1 },
                  },
                },
              ]
            : undefined,
          properties: {
            severity: change.severity,
            before: change.before,
            after: change.after,
          },
        })),
      },
    ],
  };
}

function assertDriftFormat(format: string): asserts format is "json" | "md" | "sarif" {
  if (format !== "json" && format !== "md" && format !== "sarif") {
    throw new CliExitError("--format must be one of: json, md, sarif", ExitCode.Config);
  }
}

function writeSyncSummary(summary: {
  dryRun: boolean;
  manifestPath: string;
  projectContextPath: string;
  adapters: string[];
  duration_ms: number;
  warnings: string[];
}) {
  process.stdout.write(summary.dryRun ? "Sync dry run completed.\n" : "Sync completed.\n");
  process.stdout.write(`Manifest: ${summary.manifestPath}\n`);
  process.stdout.write(`Project context: ${summary.projectContextPath}\n`);
  process.stdout.write(`Adapters: ${summary.adapters.length > 0 ? summary.adapters.join(", ") : "none"}\n`);
  process.stdout.write(`Duration: ${summary.duration_ms} ms\n`);
  if (summary.warnings.length > 0) {
    process.stdout.write("\nWarnings:\n");
    for (const warning of summary.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
}

const program = new Command();
program.name("axictx").description("AxiContext OSS CLI");

program
  .command("init")
  .description("Scaffold the .axicontext setup in this repository")
  .option("--repo-root <path>", "repository root to use")
  .option("--overwrite-config", "Overwrite .axicontext/config.toml if it already exists", false)
  .option("--yes", "Run without prompts", false)
  .option("--json", "emit JSON result", false)
  .action(async (options: RepoRootOption & { overwriteConfig: boolean; yes: boolean; json: boolean }) => {
    const repoRoot = resolveCliRepoRoot(options);
    const result = await scaffoldAxiContext({
      repoRoot,
      overwriteConfig: options.overwriteConfig,
    });

    if (options.json) {
      print(result);
      return;
    }

    console.log(`Repository type: ${result.repositoryType}`);
    console.log(`Config path: ${result.configPath}`);
    console.log(result.createdAxiContextDir ? "Created .axicontext/ directory." : ".axicontext/ already exists.");
    console.log(
      result.createdConfig
        ? "Wrote .axicontext/config.toml."
        : ".axicontext/config.toml already exists (use --overwrite-config to replace).",
    );
    console.log(
      result.createdProjectContext
        ? "Created PROJECT_CONTEXT.md."
        : "PROJECT_CONTEXT.md already exists.",
    );

    if (result.missingGitignoreEntries.length > 0) {
      console.log("\nSuggested additions to .gitignore:");
      for (const entry of result.missingGitignoreEntries) {
        console.log(entry);
      }
    }
  });

program
  .command("doctor")
  .description("Validate local AxiContext setup")
  .option("--repo-root <path>", "repository root to inspect")
  .action(async (options: RepoRootOption) => {
    const repoRoot = resolveCliRepoRoot(options);
    const checks: Array<{ status: "ok" | "warn" | "error"; name: string; detail: string; configError?: boolean }> = [];
    const axiContextDir = path.join(repoRoot, AXICONTEXT_DIR);
    const configPath = path.join(axiContextDir, CONFIG_FILE_NAME);
    const manifestPath = path.join(axiContextDir, "manifest.json");
    const graphPath = path.join(axiContextDir, "graph", "graph.sqlite");

    checks.push(
      nodeVersionIsSupported()
        ? { status: "ok", name: "node", detail: `Node.js ${process.versions.node}` }
        : { status: "error", name: "node", detail: `Node.js 22+ is required. Current: ${process.versions.node}` },
    );

    const hasAxiContextDir = await pathExists(axiContextDir);
    checks.push(
      hasAxiContextDir
        ? { status: "ok", name: ".axicontext", detail: `${axiContextDir} exists` }
        : { status: "error", name: ".axicontext", detail: `${axiContextDir} is missing`, configError: true },
    );

    let config: AxiContextConfig | null = null;
    try {
      config = await loadAxiContextConfig(repoRoot);
      checks.push({ status: "ok", name: "config", detail: `${configPath} parses` });
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        checks.push({ status: "error", name: "config", detail: error.message, configError: true });
      } else {
        throw error;
      }
    }

    const manifestExists = await pathExists(manifestPath);
    if (manifestExists) {
      checks.push(
        (await pathReadable(manifestPath))
          ? { status: "ok", name: "manifest", detail: `${manifestPath} is readable` }
          : { status: "error", name: "manifest", detail: `${manifestPath} is not readable`, configError: true },
      );
      checks.push(
        (await pathReadable(graphPath))
          ? { status: "ok", name: "graph", detail: `${graphPath} is readable` }
          : { status: "warn", name: "graph", detail: `${graphPath} is missing or not readable; run axictx sync` },
      );
    } else {
      checks.push({ status: "warn", name: "manifest", detail: `${manifestPath} is missing; run axictx sync` });
    }

    if (config && !isLoopbackHost(config.serve.host) && config.serve.api_token.trim() === "") {
      checks.push({
        status: "warn",
        name: "serve",
        detail: `serve.host is ${config.serve.host} but serve.api_token is empty`,
      });
    }

    for (const check of checks) {
      const prefix = check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "error";
      process.stdout.write(`[${prefix}] ${check.name}: ${check.detail}\n`);
    }

    const errors = checks.filter((check) => check.status === "error");
    if (errors.length > 0) {
      const hasConfigError = errors.some((check) => check.configError);
      process.exit(hasConfigError ? ExitCode.Config : ExitCode.Error);
    }
  });

program
  .command("sync")
  .description("Run source adapters and regenerate PROJECT_CONTEXT.md")
  .option("--repo-root <path>", "repository root to scan")
  .option("--max-chars <value>", "maximum PROJECT_CONTEXT output size")
  .option("--max-files <value>", "maximum excerpted files")
  .option("--max-lines-per-file <value>", "maximum lines per excerpted file")
  .option("--fail-on-drift", "exit with code 2 when drift is detected after sync", false)
  .option("--dry-run", "run without writing manifest or PROJECT_CONTEXT.md", false)
  .option("--adapters <csv>", "comma-separated adapter ids to run")
  .option("--json", "emit JSON result", false)
  .action(
    async (options: {
      repoRoot?: string;
      maxChars?: string;
      maxFiles?: string;
      maxLinesPerFile?: string;
      failOnDrift: boolean;
      dryRun: boolean;
      adapters?: string;
      json: boolean;
    }) => {
      const repoRoot = resolveCliRepoRoot(options);
      const adapterIds = parseAdapterCsv(options.adapters);
      const adapters = createAdapters(adapterIds);
      const startedAt = Date.now();
      const result = await runSync(repoRoot, {
        adapters,
        adapterIds,
        dryRun: options.dryRun,
        maxChars: options.maxChars ? parsePositiveInt(options.maxChars, "--max-chars") : undefined,
        maxFiles: options.maxFiles ? parsePositiveInt(options.maxFiles, "--max-files") : undefined,
        maxLinesPerFile: options.maxLinesPerFile
          ? parsePositiveInt(options.maxLinesPerFile, "--max-lines-per-file")
          : undefined,
      });
      const durationMs = Date.now() - startedAt;

      const warnings = [...result.warnings];
      const adapterOutputIds = Object.keys(result.manifest.adapters);
      const summary = {
        dryRun: options.dryRun,
        manifestPath: result.manifestPath,
        projectContextPath: result.projectContextPath,
        adapters: adapterOutputIds,
        duration_ms: durationMs,
        warnings,
      };

      let exitCode = ExitCode.Ok;
      if (adapters.length > 0 && adapterOutputIds.length === 0) {
        warnings.push("No selected adapters produced context.");
        exitCode = ExitCode.Adapter;
      }

      if (options.failOnDrift) {
        const report = await detectDrift(repoRoot);
        const config = await loadAxiContextConfig(repoRoot);
        if (shouldExitForDrift(report, config)) {
          exitCode = ExitCode.Drift;
        }
      }

      if (options.json) {
        print(summary);
      } else {
        writeSyncSummary(summary);
      }

      process.exitCode = exitCode;
    },
  );

program
  .command("serve")
  .description("Start Agent Read API server")
  .option("--repo-root <path>", "repository root to serve")
  .option("--port <port>", "server port", (value) => parsePositiveInt(value, "--port"))
  .option("--host <host>", "bind host")
  .action(async (options: RepoRootOption & { port?: number; host?: string }) => {
    const repoRoot = resolveCliRepoRoot(options);
    const config = await loadAxiConfig(repoRoot);
    const server = await startAxiContextServer({
      repoPath: config.repo_root,
      host: options.host ?? config.serve.host,
      port: options.port ?? config.serve.port,
      apiToken: config.serve.api_token || undefined,
    });
    process.stdout.write(
      `AxiContext server listening at ${server.url} (repo: ${server.options.repoPath})\n`,
    );
  });

program
  .command("drift")
  .description("Run context drift checks")
  .option("--repo-root <path>", "repository root to check")
  .option("--format <format>", "json|md|sarif output format", "md")
  .option("--json", "alias for --format json", false)
  .option("--ci", "print GitHub Actions annotations", false)
  .option("--fail-on-drift", "exit with code 2 when drift is detected", false)
  .action(async (options: RepoRootOption & { format: string; json: boolean; ci: boolean; failOnDrift: boolean }) => {
    const repoRoot = resolveCliRepoRoot(options);
    const format = options.json ? "json" : options.format;
    assertDriftFormat(format);
    const report = await detectDrift(repoRoot);
    if (format === "json") {
      print(report);
    } else if (format === "sarif") {
      print(formatDriftSarif(report));
    } else {
      process.stdout.write(`${formatDriftMarkdown(report)}\n`);
    }

    if (options.ci) {
      for (const annotation of formatDriftGithubAnnotations(report)) {
        process.stdout.write(`${annotation}\n`);
      }
    }

    if (options.failOnDrift) {
      const config = await loadAxiContextConfig(repoRoot);
      if (shouldExitForDrift(report, config)) {
        process.exitCode = ExitCode.Drift;
      }
    }
  });

program
  .command("query")
  .description("Query graph excerpts using keyword search")
  .argument("<question>", "question to ask the context graph")
  .option("--repo-root <path>", "repository root to query")
  .option("--max-tokens <maxTokens>", "token budget", (value) => parsePositiveInt(value, "--max-tokens"))
  .option("--json", "emit JSON result", false)
  .action(async (question: string, options: RepoRootOption & { maxTokens?: number; json: boolean }) => {
    const repoRoot = resolveCliRepoRoot(options);
    const config = await loadAxiConfig(repoRoot);
    const result = await queryContext(repoRoot, {
      question,
      max_tokens: options.maxTokens ?? config.query.max_tokens_default,
    });

    if (options.json) {
      print(result);
      return;
    }

    process.stdout.write(`Question: ${result.question}\n`);
    process.stdout.write(`Matches: ${result.answer_context.length}\n\n`);
    for (const excerpt of result.answer_context) {
      const line = firstExcerptLine(excerpt.text);
      process.stdout.write(`- ${excerpt.path}: ${line} (${excerpt.tokens} tokens)\n`);
    }
    process.stdout.write(`\ntokens_used: ${result.tokens_used}\n`);
    if (result.hint) {
      process.stdout.write(`Hint: ${result.hint}\n`);
    }
    if (result.warning) {
      process.stdout.write(`Warning: ${result.warning}\n`);
    }
  });

program
  .command("status")
  .description("Show manifest and graph summary")
  .option("--repo-root <path>", "repository root to inspect")
  .option("--json", "emit JSON result", false)
  .action(async (options: RepoRootOption & { json: boolean }) => {
    const repoRoot = resolveCliRepoRoot(options);
    const manifest = await getManifest(repoRoot);
    const context = await getContextSummary(repoRoot);
    const status = {
      manifest: {
        schema_version: manifest.schema_version,
        generated_at: manifest.generated_at ?? null,
        adapters: Object.keys(manifest.adapters),
        stats: manifest.stats ?? null,
      },
      context: {
        repo_path: path.relative(repoRoot, context.repo_path) || ".",
        file_count: context.file_count,
        auth_path_count: context.auth_path_count,
        direct_dependency_count: context.direct_dependency_count,
        excerpt_count: context.excerpts.length,
      },
    };

    if (options.json) {
      print(status);
      return;
    }

    process.stdout.write(`Manifest schema: ${status.manifest.schema_version}\n`);
    process.stdout.write(`Last sync: ${status.manifest.generated_at ?? "unknown"}\n`);
    process.stdout.write(
      `Adapters: ${status.manifest.adapters.length > 0 ? status.manifest.adapters.join(", ") : "none"}\n`,
    );
    const stats = status.manifest.stats;
    process.stdout.write(
      `Counts: ${stats?.node_count ?? context.nodes.length} nodes, ${stats?.edge_count ?? 0} edges, ${stats?.excerpt_count ?? status.context.excerpt_count} excerpts\n`,
    );
    process.stdout.write(`Files: ${status.context.file_count}\n`);
    process.stdout.write(`Auth paths: ${status.context.auth_path_count}\n`);
    process.stdout.write(`Direct dependencies: ${status.context.direct_dependency_count}\n`);
    process.stdout.write(`Excerpts: ${status.context.excerpt_count}\n`);
  });

void program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CliExitError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }
  if (error instanceof ConfigValidationError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(ExitCode.Config);
  }

  process.stderr.write(`${errorMessage(error, "Command failed.")}\n`);
  process.exit(ExitCode.Error);
});
