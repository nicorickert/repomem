---
name: repomem-distill
description: Final step after executing a plan or completing a substantial task. Review what the session produced and propose the decisions, learnings, limitations and context worth keeping, then validate them. Do not skip it because the task "felt small": decide explicitly whether anything durable came out of it.
---

# repomem — distilling a session into memory

When you finish a plan or a substantial task, the valuable knowledge lives only
in this session: why you chose an approach, what surprised you, what
constraints you hit. Once the session ends it is gone unless you write it down.

This is NOT about saving the plan. Do not persist step-by-step plans, task
lists, progress logs or any other ephemeral session state. Distill only
knowledge that will still matter weeks from now.

## Checklist (run in this order)

1. **Recall what already exists.** Call `search_memory` for each topic you are
   about to write, and `memory_for_path` on the main files you changed. You are
   looking for duplicates to extend and entries your work made false.
2. **Decide what is durable.** For each candidate ask: would a teammate who was
   not here make a worse decision without it?
   - **decision** — a non-obvious choice and the reasoning, including the
     alternative you rejected.
   - **learning** — something that surprised you or cost time.
   - **limitation** — a constraint or gotcha, including things you could NOT
     verify (for example "only tested on SQLite").
   - **context** — newly worth-writing-down understanding of what a thing is
     and how it fits.
   - **convention** — a rule future changes must follow (for example "every use
     case that mutates X must call Y"), ideally with the test that enforces it.

   If nothing qualifies, propose nothing. A clean "no entries needed" is a
   valid outcome; do not invent memory.
3. **Propose.** One `propose_memory` call per item, with a conclusion-style
   `title`, the right `type`, `tags`, and `related_paths` globs that a later
   `memory_for_path` would hit (the main source file AND the test or doc a
   maintainer would be editing). There is no `scope` parameter: module scope is
   expressed through `related_paths` and `tags`.
4. **Supersede, don't contradict.** If your work replaces an earlier decision,
   pass `supersedes` on the new entry. Call `deprecate_memory` when no
   replacement is needed.
5. **Refresh the map.** If the `repomem-map-structure` skill is available,
   follow "Keeping summaries fresh" there for the files you created or changed.
6. **Validate.** Run `npx --package @repomem/memory repomem-memory validate` and
   fix what it reports. If you cannot run it, say so explicitly.
7. **Report.** In the final message list the entries you proposed (ids), say
   they are drafts for human review, and mention validation status. Never mark
   an entry `accepted` yourself.

## Tools used

- `search_memory(query, type?, tags?)`, `memory_for_path(path)` — recall.
- `propose_memory(type, title, body, tags?, related_paths?, supersedes?)` —
  always creates a draft.
- `deprecate_memory(id, reason, superseded_by?)` — retire an entry without a
  replacement.

## Guidelines

- Prefer a few high-signal entries over many shallow ones.
- Write for someone who was not in this session; no "as discussed above".
- Record unverified assumptions as limitations rather than leaving them only in
  the chat summary.
