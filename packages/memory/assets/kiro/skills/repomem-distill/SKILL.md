---
name: repomem-distill
description: How to distill a finished piece of work into durable repomem entries. Use as the FINAL STEP after executing a plan or completing a substantial task — review what the session produced and propose the decisions, learnings, limitations, and context worth keeping for next time.
---

# repomem — distilling a session into memory

When you finish executing a plan or a substantial task, the valuable knowledge
lives only in this session: why you chose an approach, what surprised you, what
constraints you hit. Once the session ends, it is gone unless you write it down.
This skill is the final step of a plan: turn that knowledge into a small number
of durable `repomem` entries.

This is NOT about saving the plan. Do not persist the step-by-step plan, task
lists, progress logs, or any other ephemeral session state — that noise does not
belong in memory and the agent's own session already holds it. Distill only
knowledge that will still matter weeks from now.

## When to run it

- As the explicit final step after completing a plan or a non-trivial task.
- When the user asks you to "record" or "distill" what was done.

## What to distill

Review the session and identify, if any:

- **decisions** — non-obvious choices and the reasoning behind them.
- **learnings** — things that surprised you or cost time, worth remembering.
- **limitations** — new constraints or gotchas you discovered.
- **context** — project or module-level understanding that changed or is newly
  worth writing down (what a thing is, why it exists, how it fits together).

If nothing durable came out of the work, propose nothing. A clean "no entries
needed" is a valid outcome — do not invent memory.

## How to do it

1. Reflect on what the session actually accomplished and changed.
2. For each durable item, call `propose_memory` once, with:
   - a clear, specific `title`,
   - the right `type` (decision / convention / limitation / learning / context),
   - meaningful `related_paths` so `memory_for_path` can surface it later,
   - a `scope`: `project` for repo-wide knowledge, or a module name
     (e.g. `db`, `auth`, `frontend`) for module-specific knowledge.
3. Keep each entry focused: one decision/learning/limitation/context per file.
4. **Never** mark an entry `accepted` yourself. Every entry is a `draft` for a
   human to review and accept in the same pull request as the code.
5. Remind the user to run `repomem validate` before committing.

## Guidelines

- Prefer a few high-signal entries over many shallow ones.
- Write for a teammate (human or AI) who was not in this session.
- Reuse existing entries by proposing a `supersedes` reference when a decision
  replaces an earlier one, rather than silently contradicting it.
