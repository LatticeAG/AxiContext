import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".axicontext/cache"
]);

function normalizeRel(p: string): string {
  return p.split(path.sep).join("/");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listRepoFiles(repoPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(absDir: string, relDir = ""): Promise<void> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const normalized = normalizeRel(relPath);
      const absPath = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(normalized) || IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absPath, normalized);
        continue;
      }

      if (entry.isFile()) {
        results.push(normalized);
      }
    }
  }

  await walk(repoPath);
  results.sort();
  return results;
}

export async function safeReadText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 0.75);
}

export async function digestFileList(
  repoPath: string,
  files: string[]
): Promise<string> {
  const lines: string[] = [];
  for (const relPath of files) {
    const absPath = path.join(repoPath, relPath);
    const content = await safeReadText(absPath);
    lines.push(`${relPath}:${sha256(content)}`);
  }
  return sha256(lines.join("\n"));
}
