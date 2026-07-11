import { createHash } from "node:crypto";
import path from "node:path";

import type { ResolvedSyncConfig, SyncConfig } from "./types.js";

export const DEFAULT_SYNC_CONFIG: ResolvedSyncConfig = {
  maxChars: 80_000,
  maxFiles: 50,
  maxLinesPerFile: 200,
  maxTreeDepth: 3,
  maxCommits: 30,
  manifestPath: path.join(".axicontext", "manifest.json"),
  projectContextPath: "PROJECT_CONTEXT.md",
};

export function resolveConfig(config: SyncConfig = {}): ResolvedSyncConfig {
  return {
    ...DEFAULT_SYNC_CONFIG,
    ...config,
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
