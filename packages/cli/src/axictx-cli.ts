#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import {
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
  scaffoldAxiContext,
  shouldFailOnDrift,
} from "@latticeag/axicontext-core";
import { startAxiContextServer } from "@latticeag/axicontext-server";
import { runSync } from "@latticeag/axicontext-core";

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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

const program = new Command();
program.name("axictx").description("AxiContext OSS CLI");

program
  .command("init")
  .description("Scaffold the .axicontext setup in this repository")
  .option("--overwrite-config", "Overwrite .axicontext/config.toml if it already exists", false)
  .action(async (options: { overwriteConfig: boolean }) => {
    try {
      const result = await scaffoldAxiContext({
        repoRoot: process.cwd(),
        overwriteConfig: options.overwriteConfig,
      });

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

      process.exit(ExitCode.Ok);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Init failed.");
      process.exit(ExitCode.Error);
    }
  });

program
  .command("doctor")
  .description("Validate local AxiContext setup")
  .action(async () => {
    if (!nodeVersionIsSupported()) {
      console.error(`- Node.js 22+ is required. Current: ${process.versions.node}`);
      process.exit(ExitCode.Error);
    }

    try {
      await loadAxiContextConfig(process.cwd());
      console.log("AxiContext doctor checks passed.");
      process.exit(ExitCode.Ok);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        console.error(`- ${error.message}`);
        process.exit(ExitCode.Config);
      }
      console.error("- Failed to load config unexpectedly.");
      process.exit(ExitCode.Error);
    }
  });

program
  .command("sync")
  .description("Run source adapters and regenerate PROJECT_CONTEXT.md")
  .option("--repo-root <path>", "repository root to scan", process.cwd())
  .option("--max-chars <value>", "maximum PROJECT_CONTEXT output size")
  .option("--max-files <value>", "maximum excerpted files")
  .option("--max-lines-per-file <value>", "maximum lines per excerpted file")
  .option("--fail-on-drift", "exit with code 2 when drift is detected after sync", false)
  .action(
    async (options: {
      repoRoot: string;
      maxChars?: string;
      maxFiles?: string;
      maxLinesPerFile?: string;
      failOnDrift: boolean;
    }) => {
      const result = await runSync(options.repoRoot, {
        maxChars: options.maxChars ? parsePositiveInt(options.maxChars, "--max-chars") : undefined,
        maxFiles: options.maxFiles ? parsePositiveInt(options.maxFiles, "--max-files") : undefined,
        maxLinesPerFile: options.maxLinesPerFile
          ? parsePositiveInt(options.maxLinesPerFile, "--max-lines-per-file")
          : undefined,
      });

      print({
        manifestPath: result.manifestPath,
        projectContextPath: result.projectContextPath,
        adapters: Object.keys(result.manifest.adapters),
        warnings: result.warnings,
      });

      if (options.failOnDrift) {
        const report = await detectDrift(options.repoRoot);
        if (shouldFailOnDrift(report)) {
          process.exitCode = ExitCode.Drift;
        }
      }
    },
  );

program
  .command("serve")
  .description("Start Agent Read API server")
  .option("--port <port>", "server port", (value) => parsePositiveInt(value, "--port"))
  .option("--host <host>", "bind host", "127.0.0.1")
  .action(async (options: { port?: number; host?: string }) => {
    const server = await startAxiContextServer({
      repoPath: process.cwd(),
      host: options.host ?? "127.0.0.1",
      port: options.port,
    });
    process.stdout.write(
      `AxiContext server listening at ${server.url} (repo: ${server.options.repoPath})\n`,
    );
  });

program
  .command("drift")
  .description("Run context drift checks")
  .option("--format <format>", "json|md output format", "md")
  .option("--ci", "print GitHub Actions annotations", false)
  .option("--fail-on-drift", "exit with code 2 when drift is detected", false)
  .action(async (options: { format: "json" | "md"; ci: boolean; failOnDrift: boolean }) => {
    const report = await detectDrift(process.cwd());
    if (options.format === "json") {
      print(report);
    } else {
      process.stdout.write(`${formatDriftMarkdown(report)}\n`);
    }

    if (options.ci) {
      for (const annotation of formatDriftGithubAnnotations(report)) {
        process.stdout.write(`${annotation}\n`);
      }
    }

    if (options.failOnDrift && shouldFailOnDrift(report)) {
      process.exitCode = ExitCode.Drift;
    }
  });

program
  .command("query")
  .description("Query graph excerpts using keyword search")
  .argument("<question>", "question to ask the context graph")
  .option("--max-tokens <maxTokens>", "token budget", (value) => parsePositiveInt(value, "--max-tokens"))
  .option("--json", "emit JSON result", false)
  .action(async (question: string, options: { maxTokens?: number; json: boolean }) => {
    const config = await loadAxiConfig(process.cwd());
    const result = await queryContext(process.cwd(), {
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
      process.stdout.write(`- ${excerpt.path} (${excerpt.tokens} tokens)\n`);
    }
  });

program
  .command("status")
  .description("Show manifest and graph summary")
  .action(async () => {
    const manifest = await getManifest(process.cwd());
    const context = await getContextSummary(process.cwd());
    print({
      manifest: {
        schema_version: manifest.schema_version,
        generated_at: manifest.generated_at ?? null,
        adapters: Object.keys(manifest.adapters),
      },
      context: {
        repo_path: path.relative(process.cwd(), context.repo_path) || ".",
        file_count: context.file_count,
        auth_path_count: context.auth_path_count,
        direct_dependency_count: context.direct_dependency_count,
        excerpt_count: context.excerpts.length,
      },
    });
  });

void program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(ExitCode.Error);
});
