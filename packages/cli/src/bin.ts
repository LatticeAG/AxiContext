#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import {
  detectDrift,
  formatDriftGithubAnnotations,
  formatDriftMarkdown,
  getContextSummary,
  getManifest,
  loadAxiConfig,
  queryContext,
  shouldFailOnDrift
} from "@latticeag/axicontext-core";
import { startAxiContextServer } from "@latticeag/axicontext-server";

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parsePositiveInt(input: string): number {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("value must be a positive integer");
  }
  return parsed;
}

const program = new Command();
program.name("axictx").description("AxiContext OSS CLI");

program
  .command("serve")
  .description("Start Agent Read API server")
  .option("--port <port>", "server port", parsePositiveInt)
  .option("--host <host>", "bind host", "127.0.0.1")
  .action(async (options: { port?: number; host?: string }) => {
    const server = await startAxiContextServer({
      repoPath: process.cwd(),
      host: options.host ?? "127.0.0.1",
      port: options.port
    });
    process.stdout.write(
      `AxiContext server listening at ${server.url} (repo: ${server.options.repoPath})\n`
    );
  });

program
  .command("drift")
  .description("Run context drift checks")
  .option("--format <format>", "json|md output format", "md")
  .option("--ci", "print GitHub Actions annotations", false)
  .option("--fail-on-drift", "exit with code 2 when drift is detected", false)
  .action(
    async (options: { format: "json" | "md"; ci: boolean; failOnDrift: boolean }) => {
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
        process.exitCode = 2;
      }
    }
  );

program
  .command("query")
  .description("Query graph excerpts using keyword search")
  .argument("<question>", "question to ask the context graph")
  .option("--max-tokens <maxTokens>", "token budget", parsePositiveInt)
  .option("--json", "emit JSON result", false)
  .action(
    async (
      question: string,
      options: {
        maxTokens?: number;
        json: boolean;
      }
    ) => {
      const config = await loadAxiConfig(process.cwd());
      const result = await queryContext(process.cwd(), {
        question,
        max_tokens: options.maxTokens ?? config.query.max_tokens_default
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
    }
  );

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
        adapters: Object.keys(manifest.adapters)
      },
      context: {
        repo_path: path.relative(process.cwd(), context.repo_path) || ".",
        file_count: context.file_count,
        auth_path_count: context.auth_path_count,
        direct_dependency_count: context.direct_dependency_count,
        excerpt_count: context.excerpts.length
      }
    });
  });

void program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
