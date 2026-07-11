#!/usr/bin/env node

import { access } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  AXICONTEXT_DIR,
  ConfigValidationError,
  ExitCode,
  loadAxiContextConfig,
  scaffoldAxiContext,
} from "@latticeag/axicontext-core";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function nodeVersionIsSupported(version = process.versions.node): boolean {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return Number.isFinite(major) && major >= 22;
}

async function runDoctor(repoRoot = process.cwd()): Promise<ExitCode> {
  const errors: string[] = [];

  if (!nodeVersionIsSupported()) {
    errors.push(`Node.js 22+ is required. Current: ${process.versions.node}`);
  }

  const axiContextPath = path.join(repoRoot, AXICONTEXT_DIR);
  if (!(await pathExists(axiContextPath))) {
    errors.push(`Missing ${AXICONTEXT_DIR}/ directory. Run "axictx init" first.`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return ExitCode.Error;
  }

  try {
    await loadAxiContextConfig(repoRoot);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(`- ${error.message}`);
      return ExitCode.Config;
    }

    console.error("- Failed to load config unexpectedly.");
    return ExitCode.Error;
  }

  console.log("AxiContext doctor checks passed.");
  return ExitCode.Ok;
}

const program = new Command();
program.name("axictx").description("AxiContext CLI");

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
      } else {
        console.log("\nNo additional .gitignore suggestions.");
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
    const code = await runDoctor(process.cwd());
    process.exit(code);
  });

void program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown CLI error.");
  process.exit(ExitCode.Error);
});
