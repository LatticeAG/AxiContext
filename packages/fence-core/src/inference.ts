import type {
  DependencyFact,
  DockerfileFact,
  EnvExampleFact,
  LockfileFact,
  ManifestFact,
  RepoAnalysis,
  ScriptHint,
  ServiceHint,
  TargetFileFact,
} from "@latticeag/axicontext-parsers";

import { sha256Digest } from "./stable.js";
import type { FenceEcosystem, PackageManager, RuntimeKind, SetupPlan } from "./types.js";

const NODE_LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const PYTHON_LOCKFILES: Array<[string, PackageManager]> = [
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
];

const NODE_SERVICE_DEPS: Record<string, SetupPlan["services"][number]> = {
  pg: {
    name: "postgres",
    image: "postgres:16",
    port: 5432,
    env: { POSTGRES_DB: "app", POSTGRES_PASSWORD: "postgres", POSTGRES_USER: "postgres" },
  },
  postgres: {
    name: "postgres",
    image: "postgres:16",
    port: 5432,
    env: { POSTGRES_DB: "app", POSTGRES_PASSWORD: "postgres", POSTGRES_USER: "postgres" },
  },
  postgresql: {
    name: "postgres",
    image: "postgres:16",
    port: 5432,
    env: { POSTGRES_DB: "app", POSTGRES_PASSWORD: "postgres", POSTGRES_USER: "postgres" },
  },
  redis: { name: "redis", image: "redis:7", port: 6379, env: {} },
  ioredis: { name: "redis", image: "redis:7", port: 6379, env: {} },
  mysql: {
    name: "mysql",
    image: "mysql:8",
    port: 3306,
    env: { MYSQL_DATABASE: "app", MYSQL_ROOT_PASSWORD: "mysql" },
  },
  mysql2: {
    name: "mysql",
    image: "mysql:8",
    port: 3306,
    env: { MYSQL_DATABASE: "app", MYSQL_ROOT_PASSWORD: "mysql" },
  },
  mongodb: {
    name: "mongo",
    image: "mongo:7",
    port: 27017,
    env: { MONGO_INITDB_ROOT_PASSWORD: "mongo", MONGO_INITDB_ROOT_USERNAME: "mongo" },
  },
  mongoose: {
    name: "mongo",
    image: "mongo:7",
    port: 27017,
    env: { MONGO_INITDB_ROOT_PASSWORD: "mongo", MONGO_INITDB_ROOT_USERNAME: "mongo" },
  },
};

const PYTHON_SERVICE_DEPS: Record<string, SetupPlan["services"][number]> = {
  psycopg: NODE_SERVICE_DEPS.pg,
  postgres: NODE_SERVICE_DEPS.pg,
  postgresql: NODE_SERVICE_DEPS.pg,
  redis: NODE_SERVICE_DEPS.redis,
  mysql: NODE_SERVICE_DEPS.mysql,
  mongodb: NODE_SERVICE_DEPS.mongodb,
};

type DependencyInput = Record<string, string> | string[] | DependencyFact[] | undefined;

export function inferSetupPlan(analysis: RepoAnalysis): SetupPlan {
  const ecosystems = inferEcosystems(analysis);
  const runtimeKind = inferRuntimeKind(analysis, ecosystems);
  const packageManager = inferPackageManager(analysis);
  const runtime = inferRuntime(runtimeKind, analysis);
  const services = inferServices(analysis);
  const installCommands = inferInstallCommands(packageManager, analysis);
  const postCreateCommands = inferPostCreateCommands(packageManager, analysis);
  const forwardPorts = inferForwardPorts(analysis, services);
  const envKeys = inferEnvKeys(analysis);

  const planWithoutDigest = {
    schema_version: "1.0.0" as const,
    project_name: analysis.project_name || "workspace",
    ecosystems,
    package_manager: packageManager,
    runtime,
    services,
    install_commands: installCommands,
    post_create_commands: postCreateCommands,
    forward_ports: forwardPorts,
    env_keys: envKeys,
    remote_user: "vscode" as const,
    warnings: sortedUnique(analysis.warnings),
  };

  return {
    ...planWithoutDigest,
    digest: sha256Digest(planWithoutDigest),
  };
}

function inferEcosystems(analysis: RepoAnalysis): FenceEcosystem[] {
  const ecosystems = analysis.ecosystems.filter(isFenceEcosystem);

  if (ecosystems.length > 0) {
    return sortedUnique(ecosystems);
  }

  const inferred = new Set<FenceEcosystem>();
  for (const manifest of analysis.manifests) {
    if (isFenceEcosystem(manifest.ecosystem)) {
      inferred.add(manifest.ecosystem);
      continue;
    }

    if (manifest.path.endsWith("package.json")) inferred.add("node");
    if (manifest.path.endsWith("pyproject.toml") || manifest.path.endsWith("requirements.txt")) inferred.add("python");
    if (manifest.path.endsWith("Cargo.toml")) inferred.add("rust");
    if (manifest.path.endsWith("go.mod")) inferred.add("go");
  }

  return sortedUnique([...inferred]);
}

function isFenceEcosystem(ecosystem: string): ecosystem is FenceEcosystem {
  return ecosystem === "node" || ecosystem === "python" || ecosystem === "rust" || ecosystem === "go";
}

function inferRuntimeKind(analysis: RepoAnalysis, ecosystems: FenceEcosystem[]): RuntimeKind {
  if (analysis.mixed || ecosystems.length > 1) {
    return "mixed";
  }

  return ecosystems[0] ?? "node";
}

function inferPackageManager(analysis: RepoAnalysis): PackageManager {
  if (analysis.package_manager) {
    return analysis.package_manager;
  }

  const lockfilePaths = analysis.lockfiles.map((lockfile) => lockfile.path);
  const nodeLock = matchLockfile(lockfilePaths, NODE_LOCKFILES);
  if (nodeLock) return nodeLock;

  if (hasManifest(analysis, "package.json")) return "npm";

  const pythonLock = matchLockfile(lockfilePaths, PYTHON_LOCKFILES);
  if (pythonLock) return pythonLock;

  if (hasManifest(analysis, "pyproject.toml") || hasManifest(analysis, "requirements.txt")) return "pip";
  if (hasManifest(analysis, "Cargo.toml")) return "cargo";
  if (hasManifest(analysis, "go.mod")) return "go";

  return "npm";
}

function matchLockfile(paths: string[], candidates: Array<[string, PackageManager]>): PackageManager | undefined {
  for (const [filename, manager] of candidates) {
    if (paths.some((lockfilePath) => lockfilePath.endsWith(filename))) {
      return manager;
    }
  }

  return undefined;
}

function hasManifest(analysis: RepoAnalysis, filename: string): boolean {
  return analysis.manifests.some((manifest) => manifest.path.endsWith(filename));
}

function inferRuntime(kind: RuntimeKind, analysis: RepoAnalysis): SetupPlan["runtime"] {
  const primary = kind === "mixed" ? inferPrimaryEcosystem(analysis) : kind;

  if (primary === "python") {
    const version = parsePythonVersion(analysis);
    return {
      kind,
      image: `mcr.microsoft.com/devcontainers/python:${version.major}.${version.minor}`,
      version_label: version.label,
    };
  }

  if (primary === "rust") {
    return {
      kind,
      image: "mcr.microsoft.com/devcontainers/rust:1",
      version_label: "default-rust-1",
    };
  }

  if (primary === "go") {
    return {
      kind,
      image: "mcr.microsoft.com/devcontainers/go:1.22",
      version_label: "default-go-1.22",
    };
  }

  const nodeMajor = parseNodeMajor(analysis);
  return {
    kind,
    image: `mcr.microsoft.com/devcontainers/javascript-node:${nodeMajor.major}`,
    version_label: nodeMajor.label,
  };
}

function inferPrimaryEcosystem(analysis: RepoAnalysis): FenceEcosystem {
  const counts = new Map<FenceEcosystem, number>();
  for (const ecosystem of inferEcosystems(analysis)) {
    counts.set(ecosystem, 0);
  }

  for (const manifest of analysis.manifests) {
    const ecosystem = ecosystemForManifest(manifest);
    if (ecosystem) {
      counts.set(ecosystem, (counts.get(ecosystem) ?? 0) + 1);
    }
  }

  let best: FenceEcosystem = "node";
  let bestCount = -1;
  for (const ecosystem of ["node", "python", "rust", "go"] satisfies FenceEcosystem[]) {
    const count = counts.get(ecosystem) ?? 0;
    if (count > bestCount) {
      best = ecosystem;
      bestCount = count;
    }
  }

  return best;
}

function ecosystemForManifest(manifest: ManifestFact): FenceEcosystem | undefined {
  if (manifest.ecosystem === "node" || manifest.ecosystem === "python" || manifest.ecosystem === "rust" || manifest.ecosystem === "go") {
    return manifest.ecosystem;
  }

  if (manifest.path.endsWith("package.json")) return "node";
  if (manifest.path.endsWith("pyproject.toml") || manifest.path.endsWith("requirements.txt")) return "python";
  if (manifest.path.endsWith("Cargo.toml")) return "rust";
  if (manifest.path.endsWith("go.mod")) return "go";
  return undefined;
}

function parseNodeMajor(analysis: RepoAnalysis): { major: number; label: string } {
  const candidates = [
    ...analysis.runtime_hints.node_versions,
    ...analysis.manifests.map((manifest) => manifest.engines?.node),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/(\d+)/);
    if (match) {
      return { major: Number(match[1]), label: `node-${match[1]}` };
    }
  }

  return { major: 22, label: "default-node-22" };
}

function parsePythonVersion(analysis: RepoAnalysis): { major: number; minor: number; label: string } {
  const candidates = [
    ...analysis.runtime_hints.python_versions,
    ...analysis.manifests.map((manifest) => manifest.requires_python),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/3\.(\d+)/);
    if (match) {
      return { major: 3, minor: Number(match[1]), label: `python-3.${match[1]}` };
    }
  }

  return { major: 3, minor: 12, label: "default-python-3.12" };
}

function inferServices(analysis: RepoAnalysis): SetupPlan["services"] {
  const services = new Map<string, SetupPlan["services"][number]>();
  const composeServices = analysis.services
    .filter((hint) => hint.source === "compose")
    .map((hint) => normalizeServiceHint(hint))
    .filter((service) => service !== undefined);

  if (composeServices.length > 0) {
    return composeServices.sort((left, right) => left.name.localeCompare(right.name));
  }

  for (const hint of analysis.services) {
    const service = normalizeServiceHint(hint);
    if (service) {
      services.set(service.name, service);
    }
  }

  for (const dependency of collectDependencyNames(analysis)) {
    const service = NODE_SERVICE_DEPS[dependency] ?? PYTHON_SERVICE_DEPS[dependency];
    if (service) {
      services.set(service.name, service);
    }
  }

  return [...services.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeServiceHint(hint: ServiceHint): SetupPlan["services"][number] | undefined {
  const name = hint.name?.trim();
  const image = hint.image?.trim();
  const port = hint.ports[0];
  if (!name || !image || !port) {
    return undefined;
  }

  return {
    name,
    image,
    port,
    env: {},
  };
}

function collectDependencyNames(analysis: RepoAnalysis): Set<string> {
  const dependencies = new Set<string>();
  for (const manifest of analysis.manifests) {
    for (const entry of [
      manifest.dependencies,
    ]) {
      addDependencyNames(dependencies, entry);
    }
  }

  return dependencies;
}

function addDependencyNames(target: Set<string>, dependencies: DependencyInput): void {
  if (!dependencies) return;

  const names = Array.isArray(dependencies)
    ? dependencies.map((dependency) => (typeof dependency === "string" ? dependency : dependency.name))
    : Object.keys(dependencies);
  for (const name of names) {
    target.add(name.toLowerCase());
  }
}

function inferInstallCommands(packageManager: PackageManager, analysis: RepoAnalysis): string[] {
  if (packageManager === "pnpm") return ["pnpm install"];
  if (packageManager === "yarn") return [hasLockfile(analysis, "yarn.lock") ? "yarn install --frozen-lockfile" : "yarn install"];
  if (packageManager === "bun") return ["bun install"];
  if (packageManager === "poetry") return ["poetry install"];
  if (packageManager === "uv") return ["uv sync"];
  if (packageManager === "cargo") return ["cargo fetch"];
  if (packageManager === "go") return ["go mod download"];
  if (packageManager === "pip") {
    return hasManifest(analysis, "requirements.txt") ? ["python -m pip install -r requirements.txt"] : ["pip install -e ."];
  }

  return [hasLockfile(analysis, "package-lock.json") ? "npm ci" : "npm install"];
}

function hasLockfile(analysis: RepoAnalysis, filename: string): boolean {
  return analysis.lockfiles.some((lockfile) => lockfile.path.endsWith(filename));
}

function inferPostCreateCommands(packageManager: PackageManager, analysis: RepoAnalysis): string[] {
  const commands = new Set<string>();
  const packageScriptNames = new Set(["db:migrate", "migrate"]);
  const makeTargets = new Set(["migrate", "db-migrate", "setup"]);

  for (const manifest of analysis.manifests) {
    const scripts = manifest.scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) {
      if (packageScriptNames.has(name)) {
        commands.add(packageScriptCommand(packageManager, name));
      }
      if (command.trim() === "prisma migrate deploy") {
        commands.add(packageScriptCommand(packageManager, name));
      }
    }
  }

  for (const script of analysis.scripts) {
    addScriptHintCommand(commands, packageManager, script);
  }

  for (const makefile of analysis.makefiles) {
    addTargetCommands(commands, "make", makefile, makeTargets);
  }

  for (const justfile of analysis.justfiles) {
    addTargetCommands(commands, "just", justfile, makeTargets);
  }

  return [...commands].sort((left, right) => left.localeCompare(right));
}

function addScriptHintCommand(commands: Set<string>, packageManager: PackageManager, script: ScriptHint): void {
  if (script.source === "Makefile" || script.source === "Justfile") {
    const runner = script.source === "Makefile" ? "make" : "just";
    if (script.name === "migrate" || script.name === "db-migrate" || script.name === "setup") {
      commands.add(`${runner} ${script.name}`);
    }
    return;
  }

  if (script.name === "db:migrate" || script.name === "migrate") {
    commands.add(packageScriptCommand(packageManager, script.name));
  }

  if (script.command?.trim() === "prisma migrate deploy") {
    commands.add(packageScriptCommand(packageManager, script.name));
  }
}

function addTargetCommands(commands: Set<string>, runner: "make" | "just", pathFact: TargetFileFact, targets: Set<string>): void {
  for (const target of pathFact.targets ?? []) {
    if (targets.has(target)) {
      commands.add(`${runner} ${target}`);
    }
  }
}

function packageScriptCommand(packageManager: PackageManager, scriptName: string): string {
  if (packageManager === "yarn") return `yarn ${scriptName}`;
  if (packageManager === "bun") return `bun run ${scriptName}`;
  if (packageManager === "pnpm") return `pnpm run ${scriptName}`;
  return `npm run ${scriptName}`;
}

function inferForwardPorts(analysis: RepoAnalysis, services: SetupPlan["services"]): number[] {
  const ports = new Set<number>();

  for (const service of services) {
    ports.add(service.port);
  }

  for (const dockerfile of analysis.dockerfiles) {
    addDockerfilePorts(ports, dockerfile);
  }

  for (const composeFile of analysis.compose_files) {
    for (const service of composeFile.services) {
      for (const port of service.ports) {
        ports.add(port);
      }
    }
  }

  for (const port of analysis.runtime_hints.exposed_ports) {
    ports.add(port);
  }

  const dependencies = collectDependencyNames(analysis);
  if (dependencies.has("next")) ports.add(3000);
  if (dependencies.has("vite") || dependencies.has("@vitejs/plugin-react")) ports.add(5173);
  if (scriptMentionsServer(analysis) && (dependencies.has("express") || dependencies.has("hono") || dependencies.has("fastify"))) {
    ports.add(3000);
  }

  return [...ports].filter((port) => Number.isInteger(port) && port > 0).sort((left, right) => left - right);
}

function scriptMentionsServer(analysis: RepoAnalysis): boolean {
  const commands = [
    ...analysis.scripts.map((script) => script.command ?? ""),
    ...analysis.manifests.flatMap((manifest) => Object.values(manifest.scripts ?? {})),
  ];
  return commands.some((command) => /(dev|start|serve|node|tsx|ts-node)/i.test(command));
}

function inferEnvKeys(analysis: RepoAnalysis): string[] {
  const keys = new Set<string>();

  for (const example of analysis.env_examples) {
    for (const key of envExampleKeys(example)) {
      keys.add(key);
    }
  }

  return sortedUnique([...keys]);
}

function addDockerfilePorts(ports: Set<number>, dockerfile: DockerfileFact): void {
  for (const port of dockerfile.exposed_ports) {
    ports.add(port);
  }
}

function envExampleKeys(example: EnvExampleFact): string[] {
  return example.keys;
}

function sortedUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
