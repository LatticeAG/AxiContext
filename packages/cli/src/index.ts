#!/usr/bin/env node
import { Command } from "commander";

import { runSync } from "../../core/src/sync.js";

function parsePositiveInt(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program.name("axictx").description("AxiContext OSS CLI");

  program
    .command("sync")
    .description("Run source adapters and regenerate PROJECT_CONTEXT.md")
    .option("--repo-root <path>", "repository root to scan", process.cwd())
    .option("--max-chars <value>", "maximum PROJECT_CONTEXT output size")
    .option("--max-files <value>", "maximum excerpted files")
    .option("--max-lines-per-file <value>", "maximum lines per excerpted file")
    .action(
      async (options: {
        repoRoot: string;
        maxChars?: string;
        maxFiles?: string;
        maxLinesPerFile?: string;
      }) => {
        const result = await runSync(options.repoRoot, {
          maxChars: options.maxChars ? parsePositiveInt(options.maxChars, "--max-chars") : undefined,
          maxFiles: options.maxFiles ? parsePositiveInt(options.maxFiles, "--max-files") : undefined,
          maxLinesPerFile: options.maxLinesPerFile
            ? parsePositiveInt(options.maxLinesPerFile, "--max-lines-per-file")
            : undefined,
        });

        process.stdout.write(
          `${JSON.stringify(
            {
              manifestPath: result.manifestPath,
              projectContextPath: result.projectContextPath,
              adapters: Object.keys(result.manifest.adapters),
              warnings: result.warnings,
            },
            null,
            2
          )}\n`
        );
      }
    );

  await program.parseAsync(argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
