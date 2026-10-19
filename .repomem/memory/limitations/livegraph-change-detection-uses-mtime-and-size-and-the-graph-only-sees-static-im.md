---
type: limitation
title: >-
  LiveGraph change detection uses mtime and size, and the graph only sees static
  imports
status: draft
date: '2026-10-19'
scope: project
tags:
  - map
  - dependency-graph
  - gotcha
related_paths:
  - packages/map/src/deps/graph.ts
  - packages/map/src/deps/live.ts
  - packages/map/assets/kiro/skills/repomem-map-structure/SKILL.md
---
- **Change detection**: a file is considered changed when its mtime or size differs from the cached signature. An edit that leaves both identical (possible on file systems with coarse timestamps, or tools that preserve mtime) is not noticed until one of them changes. Content hashes were not used because reading every file on each check would defeat the incremental design.
- **Freshness window**: within the TTL (1000 ms by default) after a check, queries return the cached graph, so a change made in the last second may not show yet.
- **Only code files are tracked for content**: other files are only part of the resolver's file list (adding or removing one re-resolves imports). The one non-code file whose content changes trigger re-resolution is the root `tsconfig.json`, which is the only tsconfig the resolver reads for path aliases.
- **Static imports only**: dynamic wiring (dependency injection, registries, string-based loading) never appears in `get_dependents`. The skill and the instructions tell agents to also grep the symbol name when changing a constructor or a registered component.

Tests use `utimes` to force distinct mtimes so they do not depend on file-system timestamp granularity.
