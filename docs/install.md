# Install

AxiContext targets Node.js 22 or newer.

## Use from npm

After publish, install the CLI globally:

```bash
npm install -g @latticeag/axicontext
axictx --help
```

Or run it without a global install:

```bash
npx @latticeag/axicontext init
```

Then run it in the repository you want agents to understand:

```bash
cd your-repo
axictx init
axictx sync
axictx drift
```

## Use from source

Contributors should use pnpm:

```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Run the built CLI from the workspace:

```bash
pnpm --filter @latticeag/axicontext start -- init
pnpm --filter @latticeag/axicontext start -- sync
```

## Native SQLite module

The SQLite graph path uses `better-sqlite3`, which is a native Node module. Most users get a prebuilt package. If install falls back to local compilation, the machine needs a working compiler toolchain and Python available to node-gyp.

On Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

On macOS, install the Xcode command line tools:

```bash
xcode-select --install
```

## Generated files

`axictx init` creates:

```text
.axicontext/config.toml
PROJECT_CONTEXT.md
```

`axictx sync` adds or updates:

```text
.axicontext/manifest.json
.axicontext/graph/graph.sqlite
PROJECT_CONTEXT.md
```

Commit `PROJECT_CONTEXT.md`, `.axicontext/config.toml`, and `.axicontext/manifest.json` if you want CI drift checks. Keep cache and graph files out of git.
