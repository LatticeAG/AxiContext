import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AXICONTEXT_DIR,
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG_TOML,
  DEFAULT_PROJECT_CONTEXT_PATH,
  GITIGNORE_SUGGESTIONS,
} from "./constants.js";
import type { Ecosystem, InitResult, RepositoryType } from "./types.js";
import { sha256 } from "./utils.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function detectRepositoryEcosystems(repoRoot = process.cwd()): Promise<Ecosystem[]> {
  const checks: Array<[Ecosystem, string[]]> = [
    ["node", ["package.json"]],
    ["python", ["pyproject.toml", "requirements.txt", "setup.py"]],
    ["rust", ["Cargo.toml"]],
    ["go", ["go.mod"]],
  ];
  const ecosystems: Ecosystem[] = [];

  for (const [type, files] of checks) {
    for (const file of files) {
      if (await pathExists(path.join(repoRoot, file))) {
        ecosystems.push(type);
        break;
      }
    }
  }

  return ecosystems;
}

export async function detectRepositoryType(repoRoot = process.cwd()): Promise<RepositoryType> {
  const ecosystems = await detectRepositoryEcosystems(repoRoot);
  if (ecosystems.length > 1) {
    return "mixed";
  }
  return ecosystems[0] ?? "unknown";
}

function getMissingGitignoreEntries(gitignoreContent: string): string[] {
  const existing = new Set(
    gitignoreContent
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );

  return GITIGNORE_SUGGESTIONS.filter((entry) => !existing.has(entry));
}

export interface ScaffoldOptions {
  repoRoot?: string;
  overwriteConfig?: boolean;
}

function buildProjectContextStub(): string {
  const body = [
    "# Project Context",
    "",
    "<!-- axi:manual -->",
    "Describe architecture, constraints, and coding standards here. axictx preserves this block on sync.",
    "<!-- /axi:manual -->",
    "",
  ].join("\n");
  return `<!-- axi:generated managed-by=axictx schema=1.0.0 hash=${sha256(body)} -->\n${body}`;
}

export async function scaffoldAxiContext(options: ScaffoldOptions = {}): Promise<InitResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const axiContextDir = path.join(repoRoot, AXICONTEXT_DIR);
  const configPath = path.join(axiContextDir, CONFIG_FILE_NAME);
  const projectContextPath = path.join(repoRoot, DEFAULT_PROJECT_CONTEXT_PATH);
  const rootGitignorePath = path.join(repoRoot, ".gitignore");

  const hadAxiContextDir = await pathExists(axiContextDir);
  await mkdir(axiContextDir, { recursive: true });

  const configExists = await pathExists(configPath);
  if (!configExists || options.overwriteConfig) {
    await writeFile(configPath, DEFAULT_CONFIG_TOML, "utf8");
  }

  const projectContextExists = await pathExists(projectContextPath);
  if (!projectContextExists) {
    await writeFile(projectContextPath, buildProjectContextStub(), "utf8");
  }

  const rootGitignoreExists = await pathExists(rootGitignorePath);
  const gitignoreContent = rootGitignoreExists ? await readFile(rootGitignorePath, "utf8") : "";
  const missingGitignoreEntries = getMissingGitignoreEntries(gitignoreContent);

  const ecosystems = await detectRepositoryEcosystems(repoRoot);

  return {
    repositoryType: ecosystems.length > 1 ? "mixed" : ecosystems[0] ?? "unknown",
    ecosystems,
    mixed: ecosystems.length > 1,
    configPath,
    createdAxiContextDir: !hadAxiContextDir,
    createdConfig: !configExists || !!options.overwriteConfig,
    createdProjectContext: !projectContextExists,
    missingGitignoreEntries,
  };
}
