---
type: context
title: What repomem is
status: accepted
date: 2026-01-15
scope: project
tags:
  - overview
  - architecture
related_paths:
  - "src/**"
---

## What this is

repomem is a local MCP server that turns a `memory/` folder into searchable,
git-versioned context for AI assistants.

## Why it exists

Teams accumulate hard-won context — why a library was chosen, which approach
failed, what a module is allowed to touch — that usually lives in people's heads
or stale wikis. repomem keeps it next to the code, where humans and AI tools can
both find it.

## How it works

Entries are markdown files with structured frontmatter, grouped by type under
`memory/<type>s/`. AI tools propose entries as drafts; a human accepts them in
the same pull request as the related code. Markdown is the only source of
truth — no external database.

## Key constraints

Nothing becomes "accepted" memory without a human in the loop, and the server
never writes to stdout (that channel is reserved for the MCP stdio protocol).
