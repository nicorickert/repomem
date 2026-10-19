---
name: repomem-memory
description: Mandatory protocol for the repository's shared memory (decisions, conventions, limitations, learnings, context). Use at the START of every task that will modify files, however familiar the code feels, and again before finishing. Also use when the user asks "why is it this way?" or what the team already decided.
---

# repomem — the repository's shared memory

repomem turns `.repomem/memory/` into searchable, git-versioned context served
over MCP. Entries are markdown files with structured frontmatter, grouped by
type: `decisions/`, `conventions/`, `limitations/`, `learnings/`, `contexts/`.

Project docs tell you what the project is meant to be; memory tells you what the
team decided and what bit them. Having read the docs is NOT a reason to skip
this protocol.

## Protocol

**Before editing** (any task that changes files, however familiar the code feels):

1. Call `memory_for_path` once for each file you are about to modify (or its
   directory's main file). It matches entries by their `related_paths` globs.
2. Call `search_memory` with the one to three main concepts of the task. One
   search per concept, not one search for the whole task.
3. Call `get_memory` for anything relevant. If an entry contradicts your plan,
   surface it to the user before coding; do not silently override it.

An empty result is a valid answer: say so in one line and move on. Do not treat
it as "memory does not apply to this repo"; the repo may simply be young.

**While working**: when you make a non-obvious choice (you picked A over B for a
reason a teammate could not guess), note it for the end-of-task distill.

**After finishing**: follow `repomem-distill` (propose entries, then validate).

## The propose-then-review workflow

AI tools **propose** entries as drafts (`status: draft`). A human reviews and
**accepts** them in the same pull request as the related change. Never mark an
entry `accepted` yourself.

## Tools

- `search_memory(query, type?, tags?)` — full-text search. Deprecated entries
  are excluded by default.
- `get_memory(id)` — full entry by slug (the `id` returned by search).
- `memory_for_path(path)` — entries whose `related_paths` match a
  repository-relative file path; accepted entries rank above drafts.
- `propose_memory(type, title, body, tags?, related_paths?, supersedes?)` —
  creates a DRAFT. Rejects a title whose id already exists for that type and
  never overwrites. There is no `scope` parameter: express module scope with
  `related_paths` and `tags`.
- `deprecate_memory(id, reason, superseded_by?)` — mark an entry obsolete. Use
  it (or `supersedes` on the replacement) when your work makes an earlier entry
  false; do not leave contradicting entries live.

## Writing good entries

- One decision, convention, limitation, learning or context per entry.
- The title states the conclusion ("X is recorded at write time, not
  reconstructed"), not the topic ("About X").
- Always set `related_paths` with globs that a future `memory_for_path` call
  would actually hit: include the main source file AND the test or doc a
  maintainer would be editing when they need this entry.
- Body: what, why (the rejected alternative and why), and what to do when you
  touch it. Write for someone who was not in this session.
- Before proposing, `search_memory` for the same topic; extend or supersede an
  existing entry instead of adding a near-duplicate.

## Before committing

Run `npx --package @repomem/memory repomem-memory validate`. It checks
frontmatter and `supersedes` references, and scans for secrets. Tell the user if
you could not run it.
