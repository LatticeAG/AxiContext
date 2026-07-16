# CI

CI should check that generated context still matches the repository.

## GitHub Actions snippet

After packages are published:

```yaml
name: AxiContext drift

on:
  pull_request:
  push:
    branches: [main]

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @latticeag/axicontext
      - run: axictx drift --ci --fail-on-drift
```

For a repo that generates context during CI:

```yaml
- run: axictx sync
- run: axictx drift --ci --fail-on-drift
```

That pattern is useful for smoke tests, but it will not catch a missing committed context update if the job regenerates the baseline before checking drift.

## This repository

The root workflow at `.github/workflows/ci.yml` runs:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
```

It also verifies that `testdata/fixtures/minimal-node-repo` exists. Once the built CLI entrypoint exists, CI runs `init`, `sync`, and `drift` against a temporary copy of that fixture.

## Expected committed files

For drift checks to work in downstream repositories, commit:

```text
PROJECT_CONTEXT.md
.axicontext/config.toml
.axicontext/manifest.json
```

Do not commit:

```text
.axicontext/cache/
.axicontext/graph/
.axicontext/state/
.axicontext/*.local.toml
```
