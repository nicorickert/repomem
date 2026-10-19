---
type: limitation
title: Not verified that Kiro CLI puts MCP server instructions in the model's context
status: draft
date: '2026-10-19'
scope: project
tags:
  - mcp
  - kiro
  - unverified
related_paths:
  - packages/memory/src/instructions.ts
  - packages/map/src/instructions.ts
  - packages/memory/src/server.ts
  - packages/map/src/tools.ts
---
repomem sends its protocol as MCP `instructions` on `initialize`. The SDK supports it and the tests confirm a client receives the text, and a real stdio session confirmed delivery to a client. What was **not** verified is whether Kiro CLI (or any other specific client) forwards server instructions to the model. No Kiro documentation found says it does.

**Consequence**: for a client that ignores `instructions`, only the prescriptive tool descriptions and the skills reach the model. That is why the descriptions repeat the "when to call" guidance instead of relying on the instructions alone.

**What to do**: if you can, test with the client you target (start a session and ask the agent what the repomem servers told it). If a client is confirmed to ignore instructions, keep investing in the tool descriptions, which are the portable channel. Do not remove the descriptions' guidance on the assumption that instructions cover it.
