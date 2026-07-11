export type RepositoryType = "node" | "python" | "rust" | "go" | "unknown";

export interface AxiContextConfig {
  schema_version: string;
  project: {
    name: string;
    default_branch: string;
  };
  project_context: {
    path: string;
    commit: boolean;
    max_chars: number;
  };
  serve: {
    host: string;
    port: number;
  };
  drift: {
    fail_on: Array<"low" | "medium" | "high" | "critical">;
  };
  adapters: {
    git: {
      enabled: boolean;
    };
    github_issues: {
      enabled: boolean;
    };
  };
}

export interface InitResult {
  repositoryType: RepositoryType;
  configPath: string;
  createdAxiContextDir: boolean;
  createdConfig: boolean;
  createdProjectContext: boolean;
  missingGitignoreEntries: string[];
}
