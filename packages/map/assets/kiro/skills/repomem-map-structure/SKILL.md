---
name: repomem-map-structure
description: How to use the repomem-map MCP server to understand a codebase's structure — what each file is about, where a concept lives, and how modules depend on each other. Use when navigating an unfamiliar repo, locating where to make a change, or assessing the blast radius of an edit.
---

# repomem-map — the repository's structure map

repomem-map answers *what* and *where*: what each file is about and where a
concept lives. It maintains per-file summaries plus a dependency graph, served
over MCP, so you can orient quickly without reading every file.

## When to use it

- **Before editing unfamiliar code**: find the right module and read its
  summary instead of grepping blindly.
- **To locate a concept**: search for where something lives across the repo.
- **To assess impact**: inspect dependencies and the blast radius before a
  change.

## Tools

- `find_code` — search the map for files/modules matching a query. Start here.
- `get_module` — read the summary and metadata for a specific module.
- `request_summaries` — ask which files still need summaries (the agent then
  generates them).
- `save_summary` — persist a generated summary for a file (writes to the repo;
  review before committing).
- `open_graph` — open or query the dependency graph / blast radius.

## Guidelines

- Prefer `find_code` + `get_module` to build context before changing code.
- Summaries are committed to the repo; treat `save_summary` output like any
  other change and review it in a pull request.
- The dependency graph works even before summaries exist — use it to understand
  structure early.
