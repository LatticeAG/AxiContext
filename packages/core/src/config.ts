import { readFile } from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import { z } from "zod";
import { AXICONTEXT_DIR, CONFIG_FILE_NAME } from "./constants.js";
import type { AxiConfig, AxiContextConfig } from "./types.js";

const driftSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const stringArraySchema = z.array(z.string());

const axiContextConfigSchema = z.object({
  schema_version: z.literal("1.0.0"),
  project: z.object({
    name: z.string(),
    default_branch: z.string().min(1),
  }),
  project_context: z.object({
    path: z.string().min(1),
    commit: z.boolean(),
    max_chars: z.number().int().positive().max(500_000),
    llm_polish: z.literal(false),
  }),
  serve: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    api_token: z.string(),
  }),
  drift: z.object({
    fail_on: z.array(driftSeveritySchema).nonempty(),
    ignore_paths: stringArraySchema,
  }),
  adapters: z.object({
    git: z.object({
      enabled: z.boolean(),
      important_path_globs: stringArraySchema,
      recent_commits: z.number().int().nonnegative(),
      max_excerpt_files: z.number().int().positive(),
      max_lines_per_file: z.number().int().positive(),
      tree_max_depth: z.number().int().nonnegative(),
    }),
    github_issues: z.object({
      enabled: z.boolean(),
      state: z.enum(["open", "closed", "all"]),
      max_issues: z.number().int().positive(),
      label_include: stringArraySchema,
      label_exclude: stringArraySchema,
    }),
  }),
  query: z.object({
    max_tokens_default: z.number().int().positive(),
    embeddings: z.enum(["off", "auto"]),
  }),
  policy: z.object({
    denylist_globs: stringArraySchema,
    redact_patterns: stringArraySchema,
  }),
}) satisfies z.ZodType<AxiContextConfig>;

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

function parseEnvPort(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigValidationError("AXICTX_SERVE_PORT must be an integer from 1 to 65535.");
  }
  return parsed;
}

export function resolveAxiRepoRoot(repoRoot?: string): string {
  return path.resolve(repoRoot ?? process.env.AXICTX_REPO_ROOT ?? process.cwd());
}

export function getAxiContextConfigPath(repoRoot = resolveAxiRepoRoot()): string {
  if (process.env.AXICTX_CONFIG) {
    return path.resolve(process.env.AXICTX_CONFIG);
  }
  return path.join(repoRoot, AXICONTEXT_DIR, CONFIG_FILE_NAME);
}

function applyEnvironmentOverrides(config: AxiContextConfig): AxiContextConfig {
  const port = parseEnvPort(process.env.AXICTX_SERVE_PORT);
  return {
    ...config,
    serve: {
      ...config.serve,
      host: process.env.AXICTX_SERVE_HOST ?? config.serve.host,
      port: port ?? config.serve.port,
      api_token: process.env.AXICTX_API_TOKEN ?? config.serve.api_token,
    },
  };
}

export async function loadAxiContextConfig(repoRoot = resolveAxiRepoRoot()): Promise<AxiContextConfig> {
  const resolvedRoot = resolveAxiRepoRoot(repoRoot);
  const configPath = getAxiContextConfigPath(resolvedRoot);
  let rawToml: string;

  try {
    rawToml = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigValidationError(`Unable to read config file at ${configPath}.`, error);
  }

  return applyEnvironmentOverrides(parseAxiContextConfigToml(rawToml));
}

export async function loadAxiConfig(repoRoot = resolveAxiRepoRoot()): Promise<AxiConfig> {
  const resolvedRoot = resolveAxiRepoRoot(repoRoot);
  const parsed = await loadAxiContextConfig(resolvedRoot);
  return {
    serve: {
      host: parsed.serve.host,
      port: parsed.serve.port,
      api_token: parsed.serve.api_token,
    },
    query: {
      max_tokens_default: parsed.query.max_tokens_default,
      embeddings: parsed.query.embeddings,
    },
    repo_root: resolvedRoot,
    config_path: getAxiContextConfigPath(resolvedRoot),
    github_token: process.env.GITHUB_TOKEN,
    ci: process.env.CI === "1" || process.env.CI === "true",
  };
}
