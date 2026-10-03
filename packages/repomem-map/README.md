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
in-memory MiniSearch index, and four MCP tools (`request_summaries`,
`save_summary`, `find_code`, `get_module`) with a `stale` flag when a file
changed since its summary.

Not yet (planned): symbol parsing, `get_dependents`, `repo_overview`,
`--check`, merging with memory (`memory_for_path`), embeddings.

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

## Storage

One JSON per source file under `.repomem/map/summaries/`, mirroring the code
path (e.g. `src/db/client.ts` → `.repomem/map/summaries/src/db/client.ts.json`).
Each record has `hash`, `summary`, `search_terms`, `model`, `generated_at`.
These files are marked `linguist-generated` in `.gitattributes`. The search
index and staleness are computed in memory at startup and never committed.
