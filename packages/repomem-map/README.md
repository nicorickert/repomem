# repomem-map

> Status: MVP. Structure map for [repomem](../repomem). It answers **"what and
> where"**: what each file is about and where a concept lives. It is an optional
> companion to the `repomem` memory server.

The map stores one LLM-written **summary per source file**, committed to the
repo, and serves them over MCP so an agent can search the codebase and read a
module's summary. Summaries are generated **by the agent that invokes the
server** — there is no LLM provider or API key configured in the map.

## MVP scope

Included: in-agent summary generation, a committed JSON summary per file, an
in-memory MiniSearch index, and MCP tools (`request_summaries`,
`save_summary`, `find_code`, `get_module`) with a `stale` flag when a file
changed since its summary.

Also included: an in-memory **dependency graph** (file→file imports) with
blast-radius tools (`get_dependencies`, `get_dependents`) and an interactive
**web viewer** (`open_graph` / `repomem-map graph`). The graph is derived from
static imports and is independent of summaries — it works even if no summaries
have been generated.

Not yet (planned): symbol parsing, `repo_overview`, `--check`, merging with
memory (`memory_for_path`), embeddings, Python (and other languages) in the
dependency parser, and an optional LLM-derived **semantic** dependency layer
(for relationships that are not static imports, e.g. dependency injection or
cross-service calls). The current graph is intentionally parse-based and
deterministic, which is what blast-radius measurement needs.

## Setup — two levels

### 1. Register the MCP server (infra, once, manual)

Add the server to your MCP client (e.g. Kiro) alongside `repomem`:

```json
{
  "mcpServers": {
    "repomem":     { "command": "npx", "args": ["-y", "repomem"] },
    "repomem-map": { "command": "npx", "args": ["-y", "repomem-map", "--root", "."] }
  }
}
```

`repomem-map` serves over stdio. Pass `--root <dir>` to point at the repository
root (defaults to the current working directory).

### 2. Initialize the data (ask the agent)

Summaries are generated in-agent. Just ask your agent, e.g.:

> "Initialize the repo map."

The agent then runs this loop using the map's tools:

```
request_summaries(limit?)  ->  { pending: [{ path, hash }], prompt, cap }
   for each pending file:
     (agent reads the file, writes a summary following `prompt`)
     save_summary(path, summary, search_terms, hash)
repeat request_summaries() until pending is empty
```

The summary prompt lives in `prompts/summary.md` and can be edited and reviewed
in a PR.

## Tools

- `request_summaries(limit?)` — files needing a summary (missing or stale), plus
  the prompt and a per-run cap (default 20). Does **not** send file contents; the
  agent reads files itself.
- `save_summary(path, summary, search_terms, hash, model?)` — persist one
  summary. The `hash` must come from `request_summaries` and is re-validated
  against the file's current content.
- `find_code(query)` — search summaries, search terms and paths; returns compact
  hits.
- `get_module(path)` — the summary for a path, with `stale: true` when the file
  changed since the summary was generated; `found: false` when there is none.
  Always includes the file's direct `dependencies` and `dependents` from the
  import graph (even when there is no summary).
- `get_dependents(path, depth?)` — the files that depend on `path` (its **blast
  radius**), each with its hop `distance`. Transitive by default; `depth: 1`
  returns only direct dependents.
- `get_dependencies(path, depth?)` — the files `path` depends on, transitively,
  each with its hop `distance`. `depth: 1` returns only direct dependencies.
- `open_graph(port?)` — start the web viewer and return its URL.

The dependency tools and the viewer are derived from the import graph and work
**without any summaries**; summaries are optional and only enrich the viewer's
side panel.

## Dependency graph & web viewer

The map builds an in-memory **file→file dependency graph** at startup by
scanning every TS/JS file and parsing its imports with the TypeScript AST. It
is never committed — like the search index, it is recomputed from the current
code each time, so it is always fresh (the right basis for blast-radius).

- **Nodes**: every scannable TS/JS file (independent of summaries).
- **Edges**: resolved static imports. Relative imports (with implicit
  extensions and `index.*`) and `tsconfig` path aliases (`paths`/`baseUrl`) are
  resolved to repo files; Node builtins and npm packages are **not** edges yet.
- **Metrics** per node: fan-in, fan-out, number of imports and exports.
- **Cycles**: dependency cycles are detected and highlighted.

Open the viewer either from the CLI or via the `open_graph` tool:

```bash
repomem-map graph --root . [--port 7700]
```

It serves a local, interactive force-directed graph (D3). Click a node to
highlight its neighborhood and see its summary; dependency cycles are shown in
red; node size reflects either graph degree or imports+exports; and you can
filter by directory (`scope`), or focus on one file to a given `depth`. This
makes it quick to eyeball architectural smells — cycles and over-connected hubs.

The viewer frontend is a TypeScript app built with Vite and bundled locally
(no CDN); the HTTP server is separate from the MCP stdio transport.

## Storage

One JSON per source file under `.repomem/map/summaries/`, mirroring the code
path (e.g. `src/db/client.ts` → `.repomem/map/summaries/src/db/client.ts.json`).
Each record has `hash`, `summary`, `search_terms`, `model`, `generated_at`.
These files are marked `linguist-generated` in `.gitattributes`. The search
index and staleness are computed in memory at startup and never committed.
