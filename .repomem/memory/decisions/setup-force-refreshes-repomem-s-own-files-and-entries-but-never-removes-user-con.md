---
type: decision
title: >-
  setup --force refreshes repomem's own files and entries but never removes user
  content
status: draft
date: '2026-10-16'
scope: project
tags:
  - setup
  - force
  - core
  - installer
related_paths:
  - packages/core/src/kiro.ts
  - packages/core/src/fsops.ts
  - packages/core/src/command.ts
---
**Decision**: `setup --force` refreshes repomem's *own* artifacts to the version being run, and never removes user content.

**What force does**
- Overwrites copied files (skills under `.kiro/skills/*`, hook scripts under `.kiro/hooks/*`) only when their content differs; changed files are reported as `updated`, identical ones as `skipped`.
- Replaces repomem's own MCP server entries (agent config and `mcp.json`).
- Refreshes an own hook in place, identified by `command` + `matcher`.

**What force never does**
- Remove or reorder hooks the user added, even on the same trigger (earlier behaviour replaced the whole trigger array — a bug).
- Touch foreign MCP servers or foreign keys.

**Tradeoffs**
- A hand-edited skill or hook script is overwritten with no `.bak` backup; it is only listed under `updated`.
- Without `--force`, setup is purely additive and leaves existing files alone.
- The files written come from the `@repomem/memory` / `@repomem/map` versions bundled with the installer being run, so an old cached `npx` install refreshes to that old version. Use `@latest`.
