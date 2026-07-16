import type { RepoAnalysis as ParserRepoAnalysis } from "@latticeag/axicontext-parsers";

export type RepoAnalysis = ParserRepoAnalysis;

export type FenceEcosystem = "node" | "python" | "rust" | "go";
export type RuntimeKind = FenceEcosystem | "mixed";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "pip" | "poetry" | "uv" | "cargo" | "go";

export interface SetupPlan {
  schema_version: "1.0.0";
  project_name: string;
  ecosystems: string[];
  package_manager: string;
  runtime: {
    kind: RuntimeKind;
    image: string;
    version_label: string;
  };
  services: Array<{
    name: string;
    image: string;
    port: number;
    env: Record<string, string>;
  }>;
  install_commands: string[];
  post_create_commands: string[];
  forward_ports: number[];
  env_keys: string[];
  remote_user: "vscode";
  digest: string;
  warnings: string[];
}

export interface CheckItem {
  code: string;
  message: string;
  path?: string;
}

export interface CheckReport {
  schema_version: "1.0.0";
  status: "pass" | "fail";
  score: number;
  blockers: CheckItem[];
  warnings: CheckItem[];
  info: CheckItem[];
  plan_digest: string;
  generated_at: string;
}
