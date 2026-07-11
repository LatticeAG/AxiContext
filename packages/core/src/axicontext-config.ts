import { readFile } from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import { z } from "zod";
import { AXICONTEXT_DIR, CONFIG_FILE_NAME } from "./axicontext-constants.js";
import type { AxiContextConfig } from "./axicontext-types.js";

const driftSeveritySchema = z.enum(["low", "medium", "high", "critical"]);

const axiContextConfigSchema = z.object({
  schema_version: z.string().min(1),
  project: z.object({
    name: z.string(),
    default_branch: z.string().min(1),
  }),
  project_context: z.object({
    path: z.string().min(1),
    commit: z.boolean(),
    max_chars: z.number().int().positive(),
  }),
  serve: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  drift: z.object({
    fail_on: z.array(driftSeveritySchema).nonempty(),
  }),
  adapters: z.object({
    git: z.object({
      enabled: z.boolean(),
    }),
    github_issues: z.object({
      enabled: z.boolean(),
    }),
  }),
});

export class ConfigValidationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function parseAxiContextConfigToml(rawToml: string): AxiContextConfig {
  let parsed: unknown;
  try {
    parsed = TOML.parse(rawToml);
  } catch (error) {
    throw new ConfigValidationError("Unable to parse TOML configuration.", error);
  }

  const result = axiContextConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigValidationError(
      `Configuration schema validation failed: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      result.error,
    );
  }

  return result.data;
}

export function getAxiContextConfigPath(repoRoot = process.cwd()): string {
  return path.join(repoRoot, AXICONTEXT_DIR, CONFIG_FILE_NAME);
}

export async function loadAxiContextConfig(repoRoot = process.cwd()): Promise<AxiContextConfig> {
  const configPath = getAxiContextConfigPath(repoRoot);
  let rawToml: string;

  try {
    rawToml = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigValidationError(`Unable to read config file at ${configPath}.`, error);
  }

  return parseAxiContextConfigToml(rawToml);
}
