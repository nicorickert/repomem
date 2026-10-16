---
type: decision
title: repomem-map connects the MCP transport before building the dependency graph
status: draft
date: '2026-10-16'
scope: project
tags:
  - map
  - startup
  - performance
  - mcp
related_paths:
  - packages/map/src/index.ts
  - packages/map/src/scan.ts
  - packages/map/src/tools.ts
---
**Context**: On large repos `repomem-map serve` timed out at startup. `startServer` awaited `DepGraph.build(root)` before `server.connect(transport)`, so the server could not answer `initialize` until the whole repo was scanned and parsed. Measured on a synthetic 90k-file repo: 17.7s before answering `initialize`.

**Decision**: Connect the stdio transport first and build the graph in the background. `registerAllTools` / `registerQueryTools` accept `DepGraph | Promise<DepGraph>`; graph tools (`get_dependents`, `get_dependencies`, `open_graph`) await it on use. A failed build is a tool error for those tools, while `get_module` degrades to empty edges. `startServer` attaches a handler to the promise so a failed build never causes an unhandled rejection. After the change `initialize` is answered in ~0.5s on the same repo.

**Also**: `IGNORED_DIRS` in `scan.ts` was expanded (venvs, `vendor`, `build`, `out`, `target`, `.next`, caches, `coverage`, ...) because scanning those dominated build time. Tradeoff: a real source directory with one of these names (e.g. `scripts/build/`) is now skipped at any depth.

**Not changed**: `MapIndex.load` and the map root (`process.cwd()`, not the git root) still run/resolve before connect.
