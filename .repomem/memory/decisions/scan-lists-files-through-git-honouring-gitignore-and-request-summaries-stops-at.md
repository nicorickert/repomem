---
type: decision
title: >-
  scan() lists files through git (honouring .gitignore) and request_summaries
  stops at the limit
status: accepted
date: '2026-10-23'
scope: project
tags:
  - map
  - performance
  - scan
  - gitignore
related_paths:
  - packages/map/src/scan.ts
  - packages/map/src/pending.ts
  - packages/map/src/tools.ts
  - packages/map/test/scan.test.ts
  - packages/map/test/pending.test.ts
---
**Context**: `request_summaries` ran for 15+ minutes on a repo with 1,317 tracked files. `scan()` used `**/*` with a fixed `IGNORED_DIRS` list, so it walked 223,525 files / 5.2 GB inside gitignored `samples/*/cdk.out/` (vendored pyarrow, numpy, `.so`, `.gz`). `pending()` then read and hashed every file and only afterwards did `slice(0, cap)`, so `limit` saved nothing. Four leaked `repomem-map serve` processes (one per agent session) each also built the dependency graph over the same tree at ~100% CPU.

**Decision**: `scan(root)` (same signature) asks `git ls-files -z --cached --others --exclude-standard` first, so every `.gitignore` is honoured and ignored directories are never descended into; if `root` is not in a git repo or git fails it falls back to the fast-glob path. In both paths `IGNORED_DIRS`, dot-paths and `BINARY_EXTENSIONS` are still filtered. `pending(root, {limit, maxBytes})` examines files in batches of 32 and stops once `limit` is reached; it skips files over 1 MiB and paths that are missing or not regular files. Measured on the repo above: scan 54 s → 0.13 s; `pending` with limit 40 → 0.18 s.

**Rejected**: only adding `cdk.out` to `IGNORED_DIRS` (fixes one repo, every repo has its own generated dir; and the list already carries the "real `build/` dir is skipped" tradeoff).

**Consequences**: `request_summaries` no longer returns a total of pending files, only up to `limit`. A tracked file deleted from the working tree is still listed by `scan()` (callers must tolerate ENOENT; `DepGraph.sync` already does). Gitignored files are no longer mapped, and tracked files under `IGNORED_DIRS` names are still skipped.

**Not changed**: the size cap is not applied in `DepGraph.sync`; the map root is still `process.cwd()`; `serve` is still one process per agent session.
