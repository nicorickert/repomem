---
type: decision
title: >-
  The protocol is enforced over MCP (instructions + tool descriptions), not
  through the repomem agent config
status: draft
date: '2026-10-19'
scope: project
tags:
  - mcp
  - protocol
  - agents
  - setup
related_paths:
  - packages/memory/src/instructions.ts
  - packages/map/src/instructions.ts
  - packages/memory/src/server.ts
  - packages/map/src/server.ts
  - packages/map/src/tools.ts
  - packages/memory/test/instructions.test.ts
  - packages/map/test/instructions.test.ts
  - packages/memory/test/descriptions.test.ts
  - packages/map/src/setup/spec.ts
---
**Context**: Testing repomem in another repository with a *generic* agent showed it never called the memory or map tools. The only things that told an agent to follow the protocol were the skills, the `agentSpawn` hook and the agent config under `.kiro/agents/repomem.json`. A generic agent loads none of those, so it never saw the protocol. Skills are also only suggestions: the agent decides whether to load them.

**Decision**: Reinforce the protocol in the one channel every MCP client shares, the server itself:
1. Both servers pass `instructions` to `new McpServer(SERVER_INFO, SERVER_OPTIONS)`, so it is sent on `initialize` (`MEMORY_INSTRUCTIONS` in `packages/memory/src/instructions.ts`, `MAP_INSTRUCTIONS` in `packages/map/src/instructions.ts`).
2. Every tool description says *when* to call it ("call this BEFORE you modify a file", "AFTER you finish"), because tool descriptions reach the model in every client.
3. Skills stay as the long-form playbook and are kept consistent with both (see the skills drift convention).
4. The read-only tools the protocol asks for before every change (`get_dependents`, `get_dependencies`) are auto-approved in `setup`, so a permission prompt does not discourage using them.

**Rejected alternatives**:
- *Hooks and an agent `prompt`*: deterministic in Kiro, but they only apply to the `repomem` agent and only in Kiro, which is exactly the case that failed.
- *Skills only*: what failed.
- *A spike to check whether Kiro uses `instructions` before building anything*: skipped on purpose; descriptions cover the case where it does not.

**When you touch it**: changing, adding or renaming a tool means updating the instructions text, the tool description and the skill together. The tests check that every tool named in the instructions is registered.

**Not enforcement**: this raises the probability that a model follows the protocol; it cannot force it.
