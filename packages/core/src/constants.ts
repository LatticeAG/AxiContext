export const AXICONTEXT_DIR = ".axicontext";
export const CONFIG_FILE_NAME = "config.toml";
export const DEFAULT_PROJECT_CONTEXT_PATH = "PROJECT_CONTEXT.md";

export const DEFAULT_CONFIG_TOML = `schema_version = "1.0.0"
[project]
name = ""
default_branch = "main"
[project_context]
path = "PROJECT_CONTEXT.md"
commit = true
max_chars = 80000
[serve]
host = "127.0.0.1"
port = 8787
[drift]
fail_on = ["high", "critical"]
[adapters.git]
enabled = true
[adapters.github_issues]
enabled = false
`;

export const GITIGNORE_SUGGESTIONS = [
  ".axicontext/cache/",
  ".axicontext/state/",
  ".axicontext/*.local.toml",
] as const;

export enum ExitCode {
  Ok = 0,
  Error = 1,
  Config = 3,
}
