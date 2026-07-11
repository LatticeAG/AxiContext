import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AXICONTEXT_DIR,
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG_TOML,
  DEFAULT_PROJECT_CONTEXT_PATH,
  GITIGNORE_SUGGESTIONS,
} from "./constants.js";
import type { InitResult, RepositoryType } from "./types.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function detectRepositoryType(repoRoot = process.cwd()): Promise<RepositoryType> {
  const checks: Array<[RepositoryType, string[]]> = [
    ["node", ["package.json"]],
    ["python", ["pyproject.toml", "requirements.txt", "setup.py"]],
    ["rust", ["Cargo.toml"]],
    ["go", ["go.mod"]],
  ];

  for (const [type, files] of checks) {
    for (const file of files) {
      if (await pathExists(path.join(repoRoot, file))) {
        return type;
      }
    }
  }

  return "unknown";
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
    await writeFile(
      projectContextPath,
      "# Project Context\n\nDescribe architecture, constraints, and coding standards.\n",
      "utf8",
    );
  }

  const rootGitignoreExists = await pathExists(rootGitignorePath);
  const gitignoreContent = rootGitignoreExists ? await readFile(rootGitignorePath, "utf8") : "";
  const missingGitignoreEntries = getMissingGitignoreEntries(gitignoreContent);

  return {
    repositoryType: await detectRepositoryType(repoRoot),
    configPath,
    createdAxiContextDir: !hadAxiContextDir,
    createdConfig: !configExists || !!options.overwriteConfig,
    createdProjectContext: !projectContextExists,
    missingGitignoreEntries,
  };
}
