---
type: learning
title: 'Validate hook must call repomem-memory, not a nonexistent repomem validate'
status: accepted
date: '2026-10-16'
scope: project
tags:
  - memory
  - hooks
  - setup
  - kiro
related_paths:
  - packages/memory/assets/kiro/hooks/**
  - packages/memory/assets/kiro/skills/**
  - packages/memory/src/setup/spec.ts
---
**Problem**: The `agentSpawn` hook shipped by `@repomem/memory` ran `npx -y repomem validate`. There is no `repomem` package on npm, and the installer binary (`repomem`, from `@repomem/cli`) has no `validate` command, so the hook failed on every agent start. The same wrong command was written in the `repomem-memory` and `repomem-distill` skills.

**Fix**: use `npx -y --package @repomem/memory repomem-memory validate` (the real binary lives in `@repomem/memory`).

**Gotchas**
- `repomem-memory validate` exits non-zero when the memory folder does not exist yet; an `agentSpawn` hook failure only shows a warning in Kiro, it does not abort the session.
- Hook scripts and skills are *copied* by `setup`, so repos installed before the fix keep the old broken script until `setup --force` is re-run.
- Naming: `repomem` = installer (`@repomem/cli`), `repomem-memory` = memory server/CLI (`@repomem/memory`), `repomem-map` = map server (`@repomem/map`). Do not reference `repomem <memory-command>`.
