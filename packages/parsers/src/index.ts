import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import * as TOML from "@iarna/toml";
import { z } from "zod";

export type Ecosystem = "node" | "python" | "rust" | "go" | "java" | "unknown";

export type PackageManager =
  | "pnpm"
  | "npm"
  | "yarn"
  | "bun"
  | "pip"
  | "poetry"
  | "uv"
  | "cargo"
  | "go";

export type DependencyKind = "dependency" | "devDependency" | "peerDependency" | "optionalDependency";

export interface AnalyzeOptions {
  maxFiles?: number;
  maxDepth?: number;
}

export interface DependencyFact {
  name: string;
  version?: string;
  kind: DependencyKind;
}

export interface PathFact {
  path: string;
  role?: string;
  size_bytes?: number;
}

export interface LockfileFact extends PathFact {
  package_manager: PackageManager;
}

export interface ManifestFact extends PathFact {
  ecosystem: Ecosystem;
  kind: "package.json" | "pyproject.toml" | "Cargo.toml" | "go.mod";
  name?: string;
  dependencies: DependencyFact[];
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  package_manager?: string;
  workspaces?: string[];
  requires_python?: string;
  build_system?: string[];
  edition?: string;
  module?: string;
  go_version?: string;
}

export interface DockerfileFact extends PathFact {
  base_images: string[];
  exposed_ports: number[];
}

export interface ComposeServiceFact {
  name: string;
  image?: string;
  ports: number[];
}

export interface ComposeFileFact extends PathFact {
  services: ComposeServiceFact[];
}

export interface TargetFileFact extends PathFact {
  targets: string[];
}

export interface EnvExampleFact extends PathFact {
  keys: string[];
}

export interface TreeFact {
  files: PathFact[];
  digest: string;
}

export interface RuntimeHints {
  node_versions: string[];
  python_versions: string[];
  rust_versions: string[];
  rust_editions: string[];
  go_versions: string[];
  docker_base_images: string[];
  exposed_ports: number[];
  package_manager?: PackageManager;
}

export interface ServiceHint {
  name: string;
  kind: "postgres" | "redis" | "mysql" | "mongo" | "custom";
  source: "compose" | "dependency";
  image?: string;
  ports: number[];
  path?: string;
}

export interface ScriptHint {
  name: string;
  source: "package.json" | "Makefile" | "Justfile";
  path: string;
  command?: string;
}

export interface RepoAnalysis {
  schema_version: "1.0.0";
  root: string;
  ecosystems: Ecosystem[];
  mixed: boolean;
  project_name: string;
  manifests: ManifestFact[];
  lockfiles: LockfileFact[];
  important_files: PathFact[];
  readmes: PathFact[];
  dockerfiles: DockerfileFact[];
  compose_files: ComposeFileFact[];
  makefiles: TargetFileFact[];
  justfiles: TargetFileFact[];
  env_examples: EnvExampleFact[];
  workflows: PathFact[];
  tree: TreeFact;
  package_manager?: PackageManager;
  runtime_hints: RuntimeHints;
  services: ServiceHint[];
  scripts: ScriptHint[];
  warnings: string[];
  digest: string;
}

type RepoAnalysisWithoutDigest = Omit<RepoAnalysis, "digest">;

interface RuntimeFileHints {
  node_versions: string[];
  python_versions: string[];
  rust_versions: string[];
  go_versions: string[];
}

const ANALYSIS_SCHEMA_VERSION = "1.0.0";

const AnalyzeOptionsSchema = z
  .object({
    maxFiles: z.number().int().positive().optional(),
    maxDepth: z.number().int().positive().optional(),
  })
  .strict();

const IGNORE_DIRS = [
  "node_modules",
  ".git",
  ".axicontext/cache",
  ".axicontext/graph",
  ".axicontext/state",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  "target",
  "out",
];
const IGNORE_FILES = [".axicontext/manifest.json", "PROJECT_CONTEXT.md"];

const LOCKFILE_PACKAGE_MANAGERS = new Map<string, PackageManager>([
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["Cargo.lock", "cargo"],
  ["go.sum", "go"],
]);

const PACKAGE_MANAGER_ORDER: PackageManager[] = [
  "pnpm",
  "yarn",
  "bun",
  "npm",
  "poetry",
  "uv",
  "pip",
  "cargo",
  "go",
];

const ECOSYSTEM_ORDER: Ecosystem[] = ["node", "python", "rust", "go", "java", "unknown"];

export async function analyzeRepo(root: string, opts?: AnalyzeOptions): Promise<RepoAnalysis> {
  const options = AnalyzeOptionsSchema.parse(opts ?? {});
  const resolvedRoot = path.resolve(root);
  const allFiles = await listRepoFiles(resolvedRoot, options);
  const fileSet = new Set(allFiles);
  const warnings: string[] = [];

  const manifests = sortByPath(
    (
      await Promise.all(
        allFiles
          .filter((filePath) => isManifestPath(filePath))
          .map((filePath) => parseManifest(resolvedRoot, filePath, warnings)),
      )
    ).filter(isPresent),
  );

  const lockfiles = sortByPath(
    await Promise.all(
      allFiles
        .filter((filePath) => LOCKFILE_PACKAGE_MANAGERS.has(path.basename(filePath)))
        .map((filePath) => toLockfileFact(resolvedRoot, filePath)),
    ),
  );

  const dockerfiles = sortByPath(
    await Promise.all(
      allFiles
        .filter((filePath) => path.basename(filePath).startsWith("Dockerfile"))
        .map((filePath) => parseDockerfile(resolvedRoot, filePath, warnings)),
    ),
  );

  const composeFiles = sortByPath(
    await Promise.all(
      allFiles
        .filter(isComposePath)
        .map((filePath) => parseComposeFile(resolvedRoot, filePath, warnings)),
    ),
  );

  const makefiles = sortByPath(
    await Promise.all(
      allFiles
        .filter((filePath) => path.basename(filePath) === "Makefile")
        .map((filePath) => parseTargetFile(resolvedRoot, filePath, "make", warnings)),
    ),
  );

  const justfiles = sortByPath(
    await Promise.all(
      allFiles
        .filter((filePath) => path.basename(filePath) === "Justfile")
        .map((filePath) => parseTargetFile(resolvedRoot, filePath, "just", warnings)),
    ),
  );

  const envExamples = sortByPath(
    await Promise.all(
      allFiles
        .filter(isEnvExamplePath)
        .map((filePath) => parseEnvExample(resolvedRoot, filePath, warnings)),
    ),
  );

  const readmes = sortByPath(await Promise.all(allFiles.filter(isReadmePath).map((filePath) => toPathFact(resolvedRoot, filePath, "readme"))));
  const workflows = sortByPath(await Promise.all(allFiles.filter(isWorkflowPath).map((filePath) => toPathFact(resolvedRoot, filePath, "workflow"))));
  const importantFiles = await importantPathFacts(resolvedRoot, allFiles);
  const tree = await buildTreeFact(resolvedRoot, allFiles);
  const ecosystems = inferEcosystems(manifests);
  const packageManager = inferPackageManager({ manifests, lockfiles, fileSet });
  const runtimeFileHints = await parseRuntimeFiles(resolvedRoot, allFiles, warnings);
  const runtimeHints = buildRuntimeHints({ manifests, dockerfiles, packageManager, runtimeFileHints });
  const services = inferServices({ manifests, composeFiles });
  const scripts = collectScripts({ manifests, makefiles, justfiles });

  const analysisWithoutDigest: RepoAnalysisWithoutDigest = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    root: resolvedRoot,
    ecosystems,
    mixed: ecosystems.filter((ecosystem) => ecosystem !== "unknown").length >= 2,
    project_name: inferProjectName(resolvedRoot, manifests),
    manifests,
    lockfiles,
    important_files: importantFiles,
    readmes,
    dockerfiles,
    compose_files: composeFiles,
    makefiles,
    justfiles,
    env_examples: envExamples,
    workflows,
    tree,
    package_manager: packageManager,
    runtime_hints: runtimeHints,
    services,
    scripts,
    warnings: warnings.sort(),
  };

  return {
    ...analysisWithoutDigest,
    digest: digestAnalysis(analysisWithoutDigest),
  };
}

function listRepoFiles(root: string, options: AnalyzeOptions): Promise<string[]> {
  const ignore = [...IGNORE_DIRS.map((directory) => `**/${directory}/**`), ...IGNORE_FILES];
  return fg(["**/*"], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    unique: true,
    ignore,
    deep: options.maxDepth,
  }).then((files) => {
    const normalized = files.map(normalizePath).sort();
    return options.maxFiles === undefined ? normalized : normalized.slice(0, options.maxFiles);
  });
}

function isManifestPath(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName === "package.json" || baseName === "pyproject.toml" || baseName === "Cargo.toml" || baseName === "go.mod";
}

async function parseManifest(root: string, filePath: string, warnings: string[]): Promise<ManifestFact | undefined> {
  const baseName = path.basename(filePath);
  try {
    if (baseName === "package.json") {
      return await parsePackageJson(root, filePath);
    }
    if (baseName === "pyproject.toml") {
      return await parsePyproject(root, filePath);
    }
    if (baseName === "Cargo.toml") {
      return await parseCargoToml(root, filePath);
    }
    if (baseName === "go.mod") {
      return await parseGoMod(root, filePath);
    }
  } catch (error) {
    warnings.push(`${filePath}: ${errorMessage(error)}`);
  }
  return undefined;
}

async function parsePackageJson(root: string, filePath: string): Promise<ManifestFact> {
  const text = await readText(root, filePath);
  const parsed: unknown = JSON.parse(text);
  const object = requireRecord(parsed, filePath);
  const dependencies = [
    ...dependencyMapFacts(object.dependencies, "dependency"),
    ...dependencyMapFacts(object.devDependencies, "devDependency"),
    ...dependencyMapFacts(object.peerDependencies, "peerDependency"),
    ...dependencyMapFacts(object.optionalDependencies, "optionalDependency"),
  ];
  const scripts = stringRecord(object.scripts);
  const engines = stringRecord(object.engines);
  const packageManager = typeof object.packageManager === "string" ? object.packageManager : undefined;
  return {
    ...(await toPathFact(root, filePath, "manifest")),
    ecosystem: "node",
    kind: "package.json",
    name: typeof object.name === "string" ? object.name : undefined,
    dependencies,
    scripts: Object.keys(scripts).length > 0 ? scripts : undefined,
    engines: Object.keys(engines).length > 0 ? engines : undefined,
    package_manager: packageManager,
    workspaces: workspaceList(object.workspaces),
  };
}

async function parsePyproject(root: string, filePath: string): Promise<ManifestFact> {
  const text = await readText(root, filePath);
  const parsed: unknown = TOML.parse(text);
  const object = requireRecord(parsed, filePath);
  const project = recordValue(object.project);
  const poetry = recordValue(recordValue(object.tool)?.poetry);
  const buildSystem = recordValue(object["build-system"]);
  const projectName = stringValue(project?.name) ?? stringValue(poetry?.name);
  const dependencies = [
    ...dependencyListFacts(arrayValue(project?.dependencies), "dependency"),
    ...optionalDependencyFacts(recordValue(project?.["optional-dependencies"])),
    ...dependencyMapFacts(recordValue(poetry?.dependencies), "dependency"),
    ...dependencyMapFacts(recordValue(poetry?.["dev-dependencies"]), "devDependency"),
  ];
  const buildRequires = arrayValue(buildSystem?.requires).flatMap((value) => (typeof value === "string" ? [value] : []));
  return {
    ...(await toPathFact(root, filePath, "manifest")),
    ecosystem: "python",
    kind: "pyproject.toml",
    name: projectName,
    dependencies,
    requires_python: stringValue(project?.["requires-python"]),
    build_system: buildRequires.length > 0 ? buildRequires : undefined,
  };
}

async function parseCargoToml(root: string, filePath: string): Promise<ManifestFact> {
  const text = await readText(root, filePath);
  const parsed: unknown = TOML.parse(text);
  const object = requireRecord(parsed, filePath);
  const pkg = recordValue(object.package);
  const workspace = recordValue(object.workspace);
  const dependencies = [
    ...dependencyMapFacts(recordValue(object.dependencies), "dependency"),
    ...dependencyMapFacts(recordValue(object["dev-dependencies"]), "devDependency"),
    ...dependencyMapFacts(recordValue(object["build-dependencies"]), "devDependency"),
  ];
  return {
    ...(await toPathFact(root, filePath, "manifest")),
    ecosystem: "rust",
    kind: "Cargo.toml",
    name: stringValue(pkg?.name),
    dependencies,
    edition: stringValue(pkg?.edition),
    workspaces: arrayValue(workspace?.members).flatMap((value) => (typeof value === "string" ? [value] : [])),
  };
}

async function parseGoMod(root: string, filePath: string): Promise<ManifestFact> {
  const text = await readText(root, filePath);
  const moduleMatch = text.match(/^module\s+(\S+)/m);
  const goMatch = text.match(/^go\s+(\S+)/m);
  const dependencies: DependencyFact[] = [];
  const requireBlock = text.match(/^require\s*\(([\s\S]*?)^\)/m);
  if (requireBlock?.[1] !== undefined) {
    for (const line of requireBlock[1].split("\n")) {
      const dependency = parseGoRequireLine(line);
      if (dependency !== undefined) {
        dependencies.push(dependency);
      }
    }
  }
  for (const line of text.split("\n")) {
    const dependency = parseGoRequireLine(line.replace(/^require\s+/, ""));
    if (dependency !== undefined) {
      dependencies.push(dependency);
    }
  }
  return {
    ...(await toPathFact(root, filePath, "manifest")),
    ecosystem: "go",
    kind: "go.mod",
    name: moduleMatch?.[1],
    module: moduleMatch?.[1],
    go_version: goMatch?.[1],
    dependencies: uniqueDependencies(dependencies),
  };
}

function parseGoRequireLine(line: string): DependencyFact | undefined {
  const trimmed = line.replace(/\/\/.*$/, "").trim();
  if (trimmed.length === 0 || trimmed === "(" || trimmed === ")") {
    return undefined;
  }
  const match = trimmed.match(/^(\S+)\s+(\S+)/);
  if (match === null) {
    return undefined;
  }
  return { name: match[1], version: match[2], kind: "dependency" };
}

async function toLockfileFact(root: string, filePath: string): Promise<LockfileFact> {
  const packageManager = LOCKFILE_PACKAGE_MANAGERS.get(path.basename(filePath));
  if (packageManager === undefined) {
    throw new Error(`Unsupported lockfile ${filePath}`);
  }
  return {
    ...(await toPathFact(root, filePath, "lockfile")),
    package_manager: packageManager,
  };
}

async function parseDockerfile(root: string, filePath: string, warnings: string[]): Promise<DockerfileFact> {
  try {
    const text = await readText(root, filePath);
    return {
      ...(await toPathFact(root, filePath, "dockerfile")),
      base_images: uniqueSorted(
        text
          .split("\n")
          .map((line) => line.match(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+\S+)?/i)?.[1])
          .filter(isPresent),
      ),
      exposed_ports: uniqueNumbers(
        text
          .split("\n")
          .flatMap((line) => {
            const match = line.match(/^\s*EXPOSE\s+(.+)$/i);
            return match?.[1]?.split(/\s+/) ?? [];
          })
          .flatMap(parsePort),
      ),
    };
  } catch (error) {
    warnings.push(`${filePath}: ${errorMessage(error)}`);
    return { ...(await toPathFact(root, filePath, "dockerfile")), base_images: [], exposed_ports: [] };
  }
}

function isComposePath(filePath: string): boolean {
  const baseName = path.basename(filePath).toLowerCase();
  return /^docker-compose(?:\.[\w-]+)?\.ya?ml$/.test(baseName) || /^compose(?:\.[\w-]+)?\.ya?ml$/.test(baseName);
}

async function parseComposeFile(root: string, filePath: string, warnings: string[]): Promise<ComposeFileFact> {
  try {
    const text = await readText(root, filePath);
    return {
      ...(await toPathFact(root, filePath, "compose")),
      services: parseComposeServices(text),
    };
  } catch (error) {
    warnings.push(`${filePath}: ${errorMessage(error)}`);
    return { ...(await toPathFact(root, filePath, "compose")), services: [] };
  }
}

function parseComposeServices(text: string): ComposeServiceFact[] {
  const lines = text.split("\n");
  const servicesLine = lines.findIndex((line) => /^\s*services\s*:\s*(?:#.*)?$/.test(line));
  if (servicesLine < 0) {
    return [];
  }
  const servicesIndent = indentation(lines[servicesLine]);
  let serviceIndent: number | undefined;
  const services: ComposeServiceFact[] = [];
  let current: ComposeServiceFact | undefined;
  let inPorts = false;

  for (let index = servicesLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    const indent = indentation(line);
    if (indent <= servicesIndent) {
      break;
    }
    const keyMatch = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (keyMatch !== null && serviceIndent === undefined) {
      serviceIndent = keyMatch[1].length;
    }
    if (keyMatch !== null && serviceIndent === keyMatch[1].length) {
      current = { name: keyMatch[2], ports: [] };
      services.push(current);
      inPorts = false;
      continue;
    }
    if (current === undefined) {
      continue;
    }
    const trimmed = line.trim();
    const imageMatch = trimmed.match(/^image\s*:\s*["']?([^"'\s#]+)["']?/);
    if (imageMatch !== null) {
      current.image = imageMatch[1];
      inPorts = false;
      continue;
    }
    if (/^ports\s*:/.test(trimmed)) {
      inPorts = true;
      const inlinePorts = trimmed
        .replace(/^ports\s*:\s*/, "")
        .match(/\d+(?::\d+)?(?:\/\w+)?/g);
      if (inlinePorts !== null) {
        current.ports = uniqueNumbers([...current.ports, ...inlinePorts.flatMap(parsePort)]);
      }
      continue;
    }
    if (/^[A-Za-z0-9_.-]+\s*:/.test(trimmed)) {
      inPorts = false;
    }
    if (inPorts) {
      current.ports = uniqueNumbers([...current.ports, ...[trimmed].flatMap(parsePort)]);
    }
  }
  return services.sort((left, right) => left.name.localeCompare(right.name));
}

async function parseTargetFile(root: string, filePath: string, kind: "make" | "just", warnings: string[]): Promise<TargetFileFact> {
  try {
    const text = await readText(root, filePath);
    const targets = kind === "make" ? parseMakeTargets(text) : parseJustTargets(text);
    return {
      ...(await toPathFact(root, filePath, kind === "make" ? "makefile" : "justfile")),
      targets,
    };
  } catch (error) {
    warnings.push(`${filePath}: ${errorMessage(error)}`);
    return { ...(await toPathFact(root, filePath, kind === "make" ? "makefile" : "justfile")), targets: [] };
  }
}

function parseMakeTargets(text: string): string[] {
  return uniqueSorted(
    text
      .split("\n")
      .flatMap((line) => {
        if (/^\s/.test(line) || line.startsWith("#") || line.includes(":=")) {
          return [];
        }
        const match = line.match(/^([A-Za-z0-9_.-]+)\s*:(?![:=])/);
        return match?.[1] !== undefined && !match[1].startsWith(".") ? [match[1]] : [];
      }),
  );
}

function parseJustTargets(text: string): string[] {
  return uniqueSorted(
    text
      .split("\n")
      .flatMap((line) => {
        if (/^\s/.test(line) || line.startsWith("#") || line.startsWith("@")) {
          return [];
        }
        const match = line.match(/^([A-Za-z0-9_-]+)(?:\s+[^:]+)?\s*:/);
        return match?.[1] !== undefined ? [match[1]] : [];
      }),
  );
}

function isEnvExamplePath(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName === ".env.example" || baseName === ".env.sample";
}

async function parseEnvExample(root: string, filePath: string, warnings: string[]): Promise<EnvExampleFact> {
  try {
    const text = await readText(root, filePath);
    const keys = uniqueSorted(
      text
        .split("\n")
        .flatMap((line) => {
          const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
          return match?.[1] !== undefined ? [match[1]] : [];
        }),
    );
    return { ...(await toPathFact(root, filePath, "env_example")), keys };
  } catch (error) {
    warnings.push(`${filePath}: ${errorMessage(error)}`);
    return { ...(await toPathFact(root, filePath, "env_example")), keys: [] };
  }
}

function isReadmePath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase().startsWith("readme");
}

function isWorkflowPath(filePath: string): boolean {
  return normalizePath(filePath).startsWith(".github/workflows/");
}

async function importantPathFacts(root: string, files: string[]): Promise<PathFact[]> {
  const facts = await Promise.all(
    files
      .filter((filePath) => importantRole(filePath) !== undefined)
      .map((filePath) => toPathFact(root, filePath, importantRole(filePath))),
  );
  return sortByPath(facts);
}

function importantRole(filePath: string): string | undefined {
  const normalized = normalizePath(filePath);
  const baseName = path.basename(filePath);
  const lower = normalized.toLowerCase();
  if (isReadmePath(filePath)) {
    return "readme";
  }
  if (normalized.startsWith("docs/") || normalized.includes("/docs/")) {
    return "docs";
  }
  if (lower.includes("auth")) {
    return "auth";
  }
  if (baseName === "CODEOWNERS") {
    return "codeowners";
  }
  if (baseName.startsWith("LICENSE")) {
    return "license";
  }
  if (baseName === "SECURITY.md") {
    return "security";
  }
  if (isWorkflowPath(filePath)) {
    return "workflow";
  }
  return undefined;
}

async function buildTreeFact(root: string, files: string[]): Promise<TreeFact> {
  const pathFacts = sortByPath(await Promise.all(files.map((filePath) => toPathFact(root, filePath))));
  return {
    files: pathFacts,
    digest: sha256(stableStringify(pathFacts)),
  };
}

async function toPathFact(root: string, filePath: string, role?: string): Promise<PathFact> {
  const absolutePath = path.join(root, filePath);
  const fileStat = await stat(absolutePath);
  return {
    path: normalizePath(filePath),
    role,
    size_bytes: fileStat.size,
  };
}

function inferEcosystems(manifests: ManifestFact[]): Ecosystem[] {
  const detected = uniqueSorted(manifests.map((manifest) => manifest.ecosystem));
  if (detected.length === 0) {
    return ["unknown"];
  }
  return ECOSYSTEM_ORDER.filter((ecosystem) => detected.includes(ecosystem));
}

function inferPackageManager(input: {
  manifests: ManifestFact[];
  lockfiles: LockfileFact[];
  fileSet: Set<string>;
}): PackageManager | undefined {
  const lockfileManagers = input.lockfiles.map((lockfile) => lockfile.package_manager);
  for (const manager of PACKAGE_MANAGER_ORDER) {
    if (lockfileManagers.includes(manager)) {
      return manager;
    }
  }
  for (const manifest of input.manifests) {
    if (manifest.kind === "package.json" && manifest.package_manager !== undefined) {
      return parseNodePackageManager(manifest.package_manager);
    }
  }
  if (input.fileSet.has("package.json")) {
    return "npm";
  }
  if (input.fileSet.has("pyproject.toml")) {
    return "pip";
  }
  if (input.fileSet.has("Cargo.toml")) {
    return "cargo";
  }
  if (input.fileSet.has("go.mod")) {
    return "go";
  }
  return undefined;
}

function parseNodePackageManager(packageManager: string): PackageManager | undefined {
  const name = packageManager.trim().split("@")[0];
  if (name === "pnpm" || name === "npm" || name === "yarn" || name === "bun") {
    return name;
  }
  return undefined;
}

async function parseRuntimeFiles(root: string, files: string[], warnings: string[]): Promise<RuntimeFileHints> {
  const hints: RuntimeFileHints = {
    node_versions: [],
    python_versions: [],
    rust_versions: [],
    go_versions: [],
  };

  for (const filePath of files.filter(isRuntimeVersionPath)) {
    try {
      const text = await readText(root, filePath);
      const baseName = path.basename(filePath);
      if (baseName === ".nvmrc" || baseName === ".node-version") {
        hints.node_versions.push(...parseVersionFile(text));
        continue;
      }
      if (baseName === ".python-version") {
        hints.python_versions.push(...parseVersionFile(text));
        continue;
      }
      addToolVersions(hints, text);
    } catch (error) {
      warnings.push(`${filePath}: ${errorMessage(error)}`);
    }
  }

  return {
    node_versions: uniqueSorted(hints.node_versions),
    python_versions: uniqueSorted(hints.python_versions),
    rust_versions: uniqueSorted(hints.rust_versions),
    go_versions: uniqueSorted(hints.go_versions),
  };
}

function isRuntimeVersionPath(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName === ".nvmrc" || baseName === ".node-version" || baseName === ".python-version" || baseName === ".tool-versions";
}

function parseVersionFile(text: string): string[] {
  for (const line of text.split("\n")) {
    const value = meaningfulRuntimeLine(line);
    if (value !== undefined) {
      return [value];
    }
  }
  return [];
}

function addToolVersions(hints: RuntimeFileHints, text: string): void {
  for (const line of text.split("\n")) {
    const value = meaningfulRuntimeLine(line);
    if (value === undefined) {
      continue;
    }
    const [tool, ...versions] = value.split(/\s+/);
    const normalizedVersions = versions.filter((version) => version.length > 0 && version !== "system");
    if (tool === undefined || normalizedVersions.length === 0) {
      continue;
    }
    const normalizedTool = tool.toLowerCase();
    if (normalizedTool === "nodejs" || normalizedTool === "node") {
      hints.node_versions.push(...normalizedVersions);
      continue;
    }
    if (normalizedTool === "python") {
      hints.python_versions.push(...normalizedVersions);
      continue;
    }
    if (normalizedTool === "rust") {
      hints.rust_versions.push(...normalizedVersions);
      continue;
    }
    if (normalizedTool === "golang" || normalizedTool === "go") {
      hints.go_versions.push(...normalizedVersions);
    }
  }
}

function meaningfulRuntimeLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return undefined;
  }
  const uncommented = trimmed.replace(/\s+#.*$/, "").trim();
  return uncommented.length > 0 ? uncommented : undefined;
}

function buildRuntimeHints(input: {
  manifests: ManifestFact[];
  dockerfiles: DockerfileFact[];
  packageManager?: PackageManager;
  runtimeFileHints: RuntimeFileHints;
}): RuntimeHints {
  const nodeVersions = uniqueSorted([
    ...input.runtimeFileHints.node_versions,
    ...input.manifests.flatMap((manifest) => (manifest.engines?.node !== undefined ? [manifest.engines.node] : [])),
  ]);
  const pythonVersions = uniqueSorted([
    ...input.runtimeFileHints.python_versions,
    ...input.manifests.flatMap((manifest) => (manifest.requires_python !== undefined ? [manifest.requires_python] : [])),
  ]);
  const rustVersions = input.runtimeFileHints.rust_versions;
  const rustEditions = uniqueSorted(input.manifests.flatMap((manifest) => (manifest.edition !== undefined ? [manifest.edition] : [])));
  const goVersions = uniqueSorted([
    ...input.runtimeFileHints.go_versions,
    ...input.manifests.flatMap((manifest) => (manifest.go_version !== undefined ? [manifest.go_version] : [])),
  ]);
  const dockerBaseImages = uniqueSorted(input.dockerfiles.flatMap((dockerfile) => dockerfile.base_images));
  const exposedPorts = uniqueNumbers(input.dockerfiles.flatMap((dockerfile) => dockerfile.exposed_ports));
  return {
    node_versions: nodeVersions,
    python_versions: pythonVersions,
    rust_versions: rustVersions,
    rust_editions: rustEditions,
    go_versions: goVersions,
    docker_base_images: dockerBaseImages,
    exposed_ports: exposedPorts,
    package_manager: input.packageManager,
  };
}

function inferServices(input: { manifests: ManifestFact[]; composeFiles: ComposeFileFact[] }): ServiceHint[] {
  const composeServices = input.composeFiles.flatMap((composeFile) =>
    composeFile.services.map<ServiceHint>((service) => ({
      name: service.name,
      kind: serviceKindFromNameOrImage(service.name, service.image),
      source: "compose",
      image: service.image,
      ports: service.ports,
      path: composeFile.path,
    })),
  );
  const dependencyServices = uniqueKnownDependencyServices(input.manifests.flatMap((manifest) => manifest.dependencies));
  return [...composeServices, ...dependencyServices].sort((left, right) => {
    const sourceComparison = left.source.localeCompare(right.source);
    return sourceComparison === 0 ? left.name.localeCompare(right.name) : sourceComparison;
  });
}

function uniqueKnownDependencyServices(dependencies: DependencyFact[]): ServiceHint[] {
  const services = new Map<string, ServiceHint>();
  for (const dependency of dependencies) {
    const service = serviceFromDependency(dependency.name);
    if (service !== undefined && !services.has(service.kind)) {
      services.set(service.kind, service);
    }
  }
  return [...services.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function serviceFromDependency(name: string): ServiceHint | undefined {
  const normalized = normalizeDependencyName(name);
  const lowerName = name.toLowerCase();
  if (["pg", "postgres", "postgresql", "psycopg", "psycopg2"].includes(normalized) || lowerName.includes("postgres")) {
    return { name: "postgres", kind: "postgres", source: "dependency", image: "postgres:16", ports: [5432] };
  }
  if (["redis", "ioredis"].includes(normalized) || lowerName.includes("redis")) {
    return { name: "redis", kind: "redis", source: "dependency", image: "redis:7", ports: [6379] };
  }
  if (["mysql", "mysql2"].includes(normalized) || lowerName.includes("mysql")) {
    return { name: "mysql", kind: "mysql", source: "dependency", image: "mysql:8", ports: [3306] };
  }
  if (["mongodb", "mongoose"].includes(normalized) || lowerName.includes("mongo")) {
    return { name: "mongo", kind: "mongo", source: "dependency", image: "mongo:7", ports: [27017] };
  }
  return undefined;
}

function serviceKindFromNameOrImage(name: string, image?: string): ServiceHint["kind"] {
  const value = `${name} ${image ?? ""}`.toLowerCase();
  if (value.includes("postgres")) {
    return "postgres";
  }
  if (value.includes("redis")) {
    return "redis";
  }
  if (value.includes("mysql")) {
    return "mysql";
  }
  if (value.includes("mongo")) {
    return "mongo";
  }
  return "custom";
}

function collectScripts(input: {
  manifests: ManifestFact[];
  makefiles: TargetFileFact[];
  justfiles: TargetFileFact[];
}): ScriptHint[] {
  const packageScripts = input.manifests.flatMap((manifest) => {
    if (manifest.scripts === undefined) {
      return [];
    }
    return Object.entries(manifest.scripts).map<ScriptHint>(([name, command]) => ({
      name,
      command,
      source: "package.json",
      path: manifest.path,
    }));
  });
  const makeTargets = input.makefiles.flatMap((makefile) =>
    makefile.targets.map<ScriptHint>((name) => ({ name, source: "Makefile", path: makefile.path })),
  );
  const justTargets = input.justfiles.flatMap((justfile) =>
    justfile.targets.map<ScriptHint>((name) => ({ name, source: "Justfile", path: justfile.path })),
  );
  return [...packageScripts, ...makeTargets, ...justTargets].sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);
    return pathComparison === 0 ? left.name.localeCompare(right.name) : pathComparison;
  });
}

function inferProjectName(root: string, manifests: ManifestFact[]): string {
  for (const manifest of manifests) {
    if (manifest.name !== undefined && manifest.name.length > 0) {
      return manifest.name;
    }
  }
  return path.basename(root);
}

function dependencyMapFacts(value: unknown, kind: DependencyKind): DependencyFact[] {
  const record = recordValue(value);
  if (record === undefined) {
    return [];
  }
  return Object.entries(record)
    .flatMap(([name, version]) => {
      if (name === "python") {
        return [];
      }
      return [{ name, version: dependencyVersion(version), kind }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function dependencyListFacts(value: unknown[], kind: DependencyKind): DependencyFact[] {
  return value
    .flatMap((dependency) => {
      if (typeof dependency !== "string") {
        return [];
      }
      const parsed = parsePythonDependencyString(dependency);
      return [{ ...parsed, kind }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function optionalDependencyFacts(record: Record<string, unknown> | undefined): DependencyFact[] {
  if (record === undefined) {
    return [];
  }
  return Object.values(record).flatMap((value) => dependencyListFacts(arrayValue(value), "optionalDependency"));
}

function parsePythonDependencyString(dependency: string): Pick<DependencyFact, "name" | "version"> {
  const trimmed = dependency.trim();
  const match = trimmed.match(/^([A-Za-z0-9_.-]+(?:\[[^\]]+\])?)\s*(.*)$/);
  if (match === null) {
    return { name: trimmed };
  }
  return {
    name: match[1].replace(/\[.*\]$/, ""),
    version: match[2].trim().length > 0 ? match[2].trim() : undefined,
  };
}

function dependencyVersion(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    const version = value.version;
    return typeof version === "string" ? version : undefined;
  }
  return undefined;
}

function workspaceList(value: unknown): string[] | undefined {
  const direct = arrayValue(value).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
  if (direct.length > 0) {
    return direct;
  }
  const packages = arrayValue(recordValue(value)?.packages).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
  return packages.length > 0 ? packages : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = recordValue(value);
  if (record === undefined) {
    return {};
  }
  return Object.fromEntries(Object.entries(record).filter(isStringEntry));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requireRecord(value: unknown, filePath: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${filePath} did not parse to an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringEntry(entry: [string, unknown]): entry is [string, string] {
  return typeof entry[1] === "string";
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function uniqueDependencies(dependencies: DependencyFact[]): DependencyFact[] {
  const byKey = new Map<string, DependencyFact>();
  for (const dependency of dependencies) {
    byKey.set(`${dependency.kind}:${dependency.name}`, dependency);
  }
  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function parsePort(value: string): number[] {
  const cleaned = value.trim().replace(/^-\s*/, "").replace(/^["'\[]+|["'\]]+$/g, "");
  const portCandidate = cleaned.split(":").at(-1)?.replace(/\/\w+$/, "") ?? cleaned;
  const match = portCandidate.match(/(\d+)/);
  if (match === null) {
    return [];
  }
  const port = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(port) ? [port] : [];
}

function normalizeDependencyName(name: string): string {
  const parts = name.toLowerCase().split("/");
  return parts[parts.length - 1] ?? name.toLowerCase();
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function sortByPath<T extends { path: string }>(facts: T[]): T[] {
  return facts.sort((left, right) => left.path.localeCompare(right.path));
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function readText(root: string, filePath: string): Promise<string> {
  return readFile(path.join(root, filePath), "utf8");
}

function digestAnalysis(analysis: RepoAnalysisWithoutDigest): string {
  return sha256(stableStringify({ ...analysis, root: "." }));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = requireRecord(value, "stableStringify");
  const entries = Object.entries(record)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
