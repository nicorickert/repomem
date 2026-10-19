---
type: convention
title: 'Shipped skills must match the real MCP tools, and a drift test enforces it'
status: draft
date: '2026-10-19'
scope: project
tags:
  - skills
  - testing
  - setup
related_paths:
  - packages/memory/assets/kiro/skills/**
  - packages/map/assets/kiro/skills/**
  - packages/memory/test/skills.test.ts
  - packages/map/test/skills.test.ts
  - packages/memory/src/instructions.ts
  - packages/map/src/instructions.ts
---
The skills under `packages/*/assets/kiro/skills/` are copied into user repositories by `setup`. When they describe a tool that does not exist or a parameter the tool does not take, agents call the API wrongly (an earlier version asked for `scope` on `propose_memory`, described `open_graph` as a query tool and omitted `get_dependents`, `get_dependencies`, `deprecate_memory` and the `context` type).

**Rule**: document every tool as a backticked signature, for example `` `propose_memory(type, title, body, tags?, related_paths?, supersedes?)` ``. `packages/memory/test/skills.test.ts` and `packages/map/test/skills.test.ts` start the real server and check that each documented tool is registered, each parameter exists in its input schema, every registered tool is documented, the validate command is the scoped `npx --package @repomem/memory repomem-memory validate` (never an unscoped `npx repomem`), and no text specific to another repository leaks in.

**When you touch it**: if you change a tool's name or parameters, update the skill, the server `instructions` and the tool description in the same change; the tests will fail until they agree. Keep skills generic: project-specific rules belong in the repository's own memory entries, not in the shipped skills.
