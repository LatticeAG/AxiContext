#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { analyzeRepo } from "@latticeag/axicontext-parsers";
import {
  generateBootstrap,
  generateComposeOverlay,
  generateDevcontainer,
  generateReadmeSetup,
  inferSetupPlan,
  scoreCheck,
  type CheckReport,
  type SetupPlan,
} from "@latticeag/axi-fence-core";
import { Command, CommanderError } from "commander";

const execFile = promisify(execFileCallback);
const VERSION = "0.1.0";

export const enum ExitCode {
  Ok = 0,
  Error = 1,
  Config = 3,
  CloneFailure = 4,
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
  }
}

interface ResolvedTarget {
  root: string;
  mode: "local" | "url";
  cleanup: () => Promise<void>;
}

interface PlannedFile {
  path: string;
  executable: boolean;
  content: string;
}

interface CheckOptions {
  json: boolean;
  ci: boolean;
  docker: boolean;
  minScore: number;
}

export interface RunOptions {
  out?: string;
  overwrite: boolean;
  dryRun: boolean;
  docker: boolean;
  allowReadmeCommands: boolean;
  json: boolean;
}

interface BadgeOptions {
  json: boolean;
}

const program = new Command();

program.name("axi-fence").description("Generate reviewable DevContainer setup for OSS repositories").version(VERSION);
program.exitOverride();

program
  .command("check")
  .argument("[target]", "local path or GitHub URL", ".")
  .option("--json", "emit JSON", false)
  .option("--ci", "compact output for CI", false)
  .option("--no-docker", "treat missing Docker hints as non-blocking")
  .option("--min-score <0-100>", "minimum passing score", parseScore, 70)
  .action(async (target: string, options: CheckOptions) => {
    const exitCode = await runCheck(target, options);
    process.exitCode = exitCode;
  });

program
  .command("run")
  .argument("[target]", "local path or GitHub URL", ".")
  .option("--out <dir>", "output directory")
  .option("--overwrite", "replace existing generated files", false)
  .option("--dry-run", "print planned file list and contents, write nothing", false)
  .option("--no-docker", "omit compose overlay")
  .option("--allow-readme-commands", "allow safe README-derived commands when parser supplies them", false)
  .option("--json", "emit JSON", false)
  .action(async (target: string, options: RunOptions) => {
    const exitCode = await runGenerate(target, options);
    process.exitCode = exitCode;
  });

program
  .command("badge")
  .argument("[target]", "local path or GitHub URL", ".")
  .option("--json", "emit JSON", false)
  .action(async (target: string, options: BadgeOptions) => {
    const exitCode = await runBadge(target, options);
    process.exitCode = exitCode;
  });

if (isMainModule()) {
  void program.parseAsync(process.argv).catch(handleCliError);
}

function handleCliError(error: unknown): never {
  if (error instanceof CommanderError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(ExitCode.Config);
  }

  if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }

  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(ExitCode.Error);
}

async function runCheck(target: string, options: CheckOptions): Promise<ExitCode> {
  const resolved = await resolveTarget(target);
  try {
    const { plan, report } = await analyzeAndScore(resolved.root, options.minScore);
    if (options.json) {
      printJson({ plan, report });
    } else {
      printCheckSummary(report, options.ci);
    }
    return report.status === "pass" ? ExitCode.Ok : ExitCode.Error;
  } finally {
    await resolved.cleanup();
  }
}

export async function runGenerate(target: string, options: RunOptions): Promise<ExitCode> {
  const resolved = await resolveTarget(target);
  try {
    if (resolved.mode === "url" && !options.out) {
      throw new CliError("URL mode for run requires --out <dir>.", ExitCode.Config);
    }

    const analysis = await analyzeRepo(resolved.root);
    const plan = inferSetupPlan(analysis);
    const outputRoot = path.resolve(options.out ?? resolved.root);
    const plannedFiles = planGeneratedFiles(options.docker ? plan : withoutServices(plan));

    if (options.dryRun) {
      if (options.json) {
        printJson({
          plan,
          files: plannedFiles.map((file) => ({
            path: file.path,
            executable: file.executable,
            content: file.content,
          })),
        });
      } else {
        printDryRun(plannedFiles);
      }
      return ExitCode.Ok;
    }

    await writeGeneratedFiles(outputRoot, plannedFiles, options.overwrite);

    if (options.json) {
      printJson({
        plan,
        files: plannedFiles.map((file) => file.path),
      });
    } else {
      process.stdout.write(`Wrote ${plannedFiles.length} files to ${outputRoot}\n`);
    }

    return ExitCode.Ok;
  } finally {
    await resolved.cleanup();
  }
}

async function runBadge(target: string, options: BadgeOptions): Promise<ExitCode> {
  const resolved = await resolveTarget(target);
  try {
    const { report } = await analyzeAndScore(resolved.root, 70);
    const badge = badgeForReport(report);
    if (options.json) {
      printJson(badge);
    } else {
      process.stdout.write(`${badge.markdown}\n`);
    }
    return report.status === "pass" ? ExitCode.Ok : ExitCode.Error;
  } finally {
    await resolved.cleanup();
  }
}

async function analyzeAndScore(root: string, minScore: number): Promise<{ plan: SetupPlan; report: CheckReport }> {
  const analysis = await analyzeRepo(root);
  const plan = inferSetupPlan(analysis);
  return {
    plan,
    report: scoreCheck(plan, analysis, minScore),
  };
}

function planGeneratedFiles(plan: SetupPlan): PlannedFile[] {
  const files: PlannedFile[] = [
    {
      path: ".devcontainer/devcontainer.json",
      executable: false,
      content: generateDevcontainer(plan),
    },
    {
      path: "scripts/bootstrap.sh",
      executable: true,
      content: generateBootstrap(plan),
    },
    {
      path: "README-SETUP.md",
      executable: false,
      content: `${generateReadmeSetup(plan, VERSION)}\n`,
    },
  ];

  const compose = generateComposeOverlay(plan);
  if (compose) {
    files.splice(1, 0, {
      path: ".devcontainer/docker-compose.yml",
      executable: false,
      content: compose,
    });
  }

  return files;
}

async function writeGeneratedFiles(outputRoot: string, files: PlannedFile[], overwrite: boolean): Promise<void> {
  for (const file of files) {
    const targetPath = safeJoin(outputRoot, file.path);
    if (!overwrite && (await pathExists(targetPath))) {
      throw new CliError(`Refusing to overwrite ${file.path}; pass --overwrite to replace it.`, ExitCode.Config);
    }
  }

  for (const file of files) {
    const targetPath = safeJoin(outputRoot, file.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf8");
    if (file.executable) {
      await chmod(targetPath, 0o755);
    }
  }
}

function safeJoin(root: string, relativePath: string): string {
  const targetPath = path.resolve(root, relativePath);
  const relative = path.relative(root, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CliError(`Generated path escapes output directory: ${relativePath}`, ExitCode.Config);
  }
  return targetPath;
}

function withoutServices(plan: SetupPlan): SetupPlan {
  return {
    ...plan,
    services: [],
    forward_ports: plan.forward_ports.filter((port) => !plan.services.some((service) => service.port === port)),
  };
}

async function resolveTarget(target: string): Promise<ResolvedTarget> {
  if (isGitHubUrl(target)) {
    return cloneTarget(target);
  }

  const root = path.resolve(target);
  if (!(await pathExists(root))) {
    throw new CliError(`Target path does not exist: ${target}`, ExitCode.Config);
  }

  return {
    root,
    mode: "local",
    cleanup: async () => {},
  };
}

async function cloneTarget(target: string): Promise<ResolvedTarget> {
  const clonePath = path.join(os.tmpdir(), `axi-fence-${shortHash(target)}`);
  try {
    await rm(clonePath, { recursive: true, force: true });
    await execFile("git", ["clone", "--depth", "1", target, clonePath]);
  } catch (error) {
    throw new CliError(`Failed to clone ${target}: ${error instanceof Error ? error.message : String(error)}`, ExitCode.CloneFailure);
  }

  return {
    root: clonePath,
    mode: "url",
    cleanup: async () => {
      await rm(clonePath, { recursive: true, force: true });
    },
  };
}

function isGitHubUrl(target: string): boolean {
  return (
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?\/?$/.test(target) ||
    /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/.test(target)
  );
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function parseScore(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new CliError("--min-score must be an integer from 0 to 100.", ExitCode.Config);
  }
  return parsed;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function printCheckSummary(report: CheckReport, compact: boolean): void {
  if (compact) {
    process.stdout.write(`AxiFence ${report.status} score=${report.score} digest=${report.plan_digest}\n`);
    return;
  }

  process.stdout.write(`AxiFence check: ${report.status}\n`);
  process.stdout.write(`Score: ${report.score}\n`);
  process.stdout.write(`Plan digest: ${report.plan_digest}\n`);
  printItems("Blockers", report.blockers);
  printItems("Warnings", report.warnings);
  printItems("Info", report.info);
}

function printItems(label: string, items: Array<{ code: string; message: string; path?: string }>): void {
  if (items.length === 0) {
    return;
  }

  process.stdout.write(`\n${label}:\n`);
  for (const item of items) {
    const suffix = item.path ? ` (${item.path})` : "";
    process.stdout.write(`- ${item.code}: ${item.message}${suffix}\n`);
  }
}

function printDryRun(files: PlannedFile[]): void {
  for (const file of files) {
    process.stdout.write(`--- ${file.path}${file.executable ? " executable" : ""}\n`);
    process.stdout.write(file.content);
    if (!file.content.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
}

export function badgeForReport(report: CheckReport): {
  status: "pass" | "fail";
  score: number;
  label: string;
  color: string;
  markdown: string;
} {
  const color = report.status === "pass" ? "green" : "red";
  const label = `${report.status}-${report.score}`;
  const markdown = `[![AxiFence ${report.score}](https://img.shields.io/badge/AxiFence-${label}-${color})](https://github.com/LatticeAG/AxiContext)`;
  return {
    status: report.status,
    score: report.score,
    label,
    color,
    markdown,
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
}
