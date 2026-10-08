---
name: repomem-memory
description: How to use the repomem MCP server to record and recall a repository's shared memory — decisions, conventions, limitations, and learnings. Use when you make a non-obvious choice worth remembering, when you need prior context before changing code, or when the user asks what the team already decided.
---

# repomem — the repository's shared memory

repomem turns a `memory/` folder into searchable, git-versioned context served
over MCP. Entries are markdown files with structured frontmatter, grouped by
type: `decisions/`, `conventions/`, `limitations/`, `learnings/`.

## When to use it

- **Before changing unfamiliar code**: search memory for related decisions and
  limitations so you don't contradict an earlier choice.
- **After making a non-obvious decision**: propose a new entry so the rationale
  survives beyond the current conversation.
- **When the user asks "why is it this way?"**: look it up instead of guessing.

## The propose-then-review workflow

AI tools **propose** entries as drafts (`status: draft`). A human reviews and
**accepts** them in the same pull request as the related change. Never mark an
entry `accepted` yourself — leave it as a draft for review.

## Tools

- `search_memory` — full-text search across all entries. Start here.
- `get_memory` — fetch a specific entry by slug.
- `memory_for_path` — find entries whose `related_paths` match a file you are
  about to touch.
- Write tools propose new draft entries; prefer small, specific entries with a
  clear title and `related_paths`.

## Guidelines

- Keep entries focused: one decision/convention/limitation/learning per file.
- Always set meaningful `related_paths` so `memory_for_path` can surface the
  entry later.
- Run `repomem validate` before committing — it checks frontmatter, supersedes
  references, and scans for secrets.
