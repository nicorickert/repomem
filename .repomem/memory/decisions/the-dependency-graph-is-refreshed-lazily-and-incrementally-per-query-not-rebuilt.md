---
type: decision
title: >-
  The dependency graph is refreshed lazily and incrementally per query, not
  rebuilt or watched
status: draft
date: '2026-10-19'
scope: project
tags:
  - map
  - dependency-graph
  - performance
related_paths:
  - packages/map/src/deps/live.ts
  - packages/map/src/deps/graph.ts
  - packages/map/src/mapindex.ts
  - packages/map/src/index.ts
  - packages/map/test/deps/live.test.ts
  - packages/map/test/deps/graph.sync.test.ts
  - packages/map/test/tools.live.test.ts
---
**Context**: `repomem-map` built the dependency graph once at startup and `MapIndex` was loaded once, so files created or edited during an agent session never appeared in `get_dependents` (the blast radius is most needed exactly then) and `find_code` could not find a summary saved by `save_summary` until a restart.

**Decision**:
- `LiveGraph` (`packages/map/src/deps/live.ts`) wraps one `DepGraph` and refreshes it only when a tool asks for the graph. It is still warmed in the background after the transport connects, so the earlier decision to answer `initialize` before building the graph still holds.
- A refresh is `scan` + one `stat` per code file (no reads). Only files whose mtime or size changed are re-read and re-parsed (`DepGraph.sync`). When files are added or removed, or the root `tsconfig.json` changes, imports are re-resolved from the parse cache (nothing is re-read), because an import that used to be unresolvable may now resolve.
- A short TTL (default 1000 ms) groups bursts of queries; concurrent callers share one refresh (single-flight). The same `DepGraph` object is updated in place and the update itself is synchronous, so readers never see a half-updated graph.
- `save_summary` calls `MapIndex.upsert`, so the summary is searchable in the same session.

**Rejected alternatives**:
- *Rebuild the whole graph whenever something changed*: every edit by the agent would reparse the whole repo on the next query.
- *`fs.watch`*: avoids the `stat` pass but brings platform quirks and process-lifecycle problems to a stdio server; the `stat` pass is cheap enough.

**When you touch it**: keep `DepGraph.sync` equivalent to `DepGraph.build` from scratch. `packages/map/test/deps/graph.sync.test.ts` compares the two after every kind of change.
