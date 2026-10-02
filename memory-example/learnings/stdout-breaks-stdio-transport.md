---
type: learning
title: Writing to stdout breaks the MCP stdio transport
status: accepted
date: 2026-02-10
tags:
  - mcp
  - debugging
related_paths:
  - "src/**"
---

A stray `console.log` corrupted the JSON-RPC stream and the client dropped the
connection with a parse error.

All diagnostics must go to stderr. stdout is reserved exclusively for protocol
messages when running over stdio.
