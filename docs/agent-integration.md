# Agent integration

AxiContext gives agents two ways to read project context:

1. `PROJECT_CONTEXT.md`, for agents and editors that load files.
2. The local Agent Read API, for tools that can call HTTP.

## File-based integration

Run:

```bash
axictx init
axictx sync
```

Then point the agent at `PROJECT_CONTEXT.md`.

For Cursor, add a project rule along these lines:

```text
Before making code changes, read PROJECT_CONTEXT.md. Treat it as generated context from AxiContext. If code behavior conflicts with the file, trust the code and run axictx sync after updating the project.
```

Keep the rule short. The generated file carries the project-specific detail.

## HTTP integration

Start the local API:

```bash
axictx serve
```

The default base URL is:

```text
http://127.0.0.1:8787
```

Health check:

```bash
curl "http://127.0.0.1:8787/healthz"
```

Fetch manifest:

```bash
curl "http://127.0.0.1:8787/v1/manifest"
```

Fetch a topic slice:

```bash
curl "http://127.0.0.1:8787/v1/context/slice?topic=authentication&max_tokens=2000"
```

Query context excerpts:

```bash
curl -X POST "http://127.0.0.1:8787/v1/context/query" \
  -H "content-type: application/json" \
  -d '{"question":"how does authentication work?","max_tokens":2000}'
```

Fetch drift:

```bash
curl "http://127.0.0.1:8787/v1/drift"
```

Fetch the OpenAPI document:

```bash
curl "http://127.0.0.1:8787/v1/openapi.json"
```

## Token budget

Use `max_tokens` on slice and query requests to keep the response small enough for the agent turn. AxiContext treats this as a budget over generated context excerpts, not as an LLM call.

## Security notes

Keep the server bound to `127.0.0.1` unless you have a specific local-network use case. The OSS CLI does not need cloud credentials.
