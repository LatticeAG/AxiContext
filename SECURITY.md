# Security policy

## Supported versions

AxiContext is pre-1.0. Security fixes target the current `main` branch and the latest published 0.x release line.

## Reporting a vulnerability

Do not open a public issue for a vulnerability.

Use GitHub private vulnerability reporting for this repository if it is enabled. If that is unavailable, contact the maintainers through the private security channel listed for the project.

Please include:

- Affected package or command
- Steps to reproduce
- Impact
- Whether repository data, generated context, or local API access is involved

## Local API threat model

`axictx serve` exposes generated project context over HTTP. It binds to `127.0.0.1` by default. Treat non-loopback binds as sensitive because anyone who can reach the port may be able to read context unless the server was started with an API token.

## Data handling

The OSS CLI is designed for local use and does not need LatticeAG cloud credentials. Generated graph and context files can still contain repository-sensitive information, so review what you commit and keep `.axicontext/graph/`, `.axicontext/cache/`, and `.axicontext/state/` out of git.
