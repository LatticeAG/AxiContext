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
llm_polish = false

[serve]
host = "127.0.0.1"
port = 8787
api_token = ""

[drift]
fail_on = ["high", "critical"]
ignore_paths = ["**/dist/**", "**/coverage/**", "**/node_modules/**"]

[adapters.git]
enabled = true
important_path_globs = ["README*", "docs/**", "**/auth/**", "CODEOWNERS", "LICENSE", "SECURITY.md", ".github/workflows/*"]
recent_commits = 30
max_excerpt_files = 50
max_lines_per_file = 200
tree_max_depth = 3

[adapters.github_issues]
enabled = false
state = "open"
max_issues = 100
label_include = []
label_exclude = []

[query]
max_tokens_default = 4000
embeddings = "off"

[policy]
denylist_globs = ["**/.env", "**/*secret*", "**/credentials*", "**/*.pem", "**/*.key"]
redact_patterns = ["default"]
`;

export const GITIGNORE_SUGGESTIONS = [
  ".axicontext/cache/",
  ".axicontext/graph/",
  ".axicontext/state/",
  ".axicontext/*.local.toml",
] as const;

export enum ExitCode {
  Ok = 0,
  Error = 1,
  Drift = 2,
  Config = 3,
  Adapter = 4,
}
