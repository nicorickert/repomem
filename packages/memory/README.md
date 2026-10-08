# @repomem/memory

**Your repo's memory, available to every AI tool your team uses.**

> npm package: [`@repomem/memory`](https://www.npmjs.com/package/@repomem/memory) ·
> CLI command: `repomem-memory`.

`@repomem/memory` is a local [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server that turns a `memory/` folder in your repository into searchable,
shared context for AI assistants. Decisions, conventions, limitations,
learnings and project context live as reviewable markdown files with structured
frontmatter, versioned with git and shared through normal pull requests. AI
tools can search and read them, and propose new entries as drafts that a human
approves in the same PR as the code change.

## Why it exists

Teams accumulate hard-won context — why a library was chosen, which approach
failed, what a module is allowed to touch. That knowledge usually lives in
people's heads, scattered chat logs, or stale wiki pages that no AI tool can
see. `repomem` keeps it next to the code, in git, where both humans and AI
assistants can find it.

Design principles:

- **Markdown is the source of truth.** No external database, no derived index
  committed to git.
- **The AI proposes, the human accepts.** AI-written entries are always created
  as `draft` and reviewed in a pull request.
- **Zero native dependencies**, so `npx` works everywhere.
- **Tool-agnostic.** Works with Kiro, Claude Code, and any MCP client.

## Quick start

Scaffold a `memory/` folder in your repo (no install needed, `npx` fetches it):

```bash
npx --package @repomem/memory repomem-memory init
```

Prefer a pinned local install? Add the package (the CLI bin is `repomem-memory`):

```bash
npm install -D @repomem/memory
```

Register the server with your AI tool (see [MCP client config](#mcp-client-config)),
then ask it to search or propose memory. Before committing, validate:

```bash
npx --package @repomem/memory repomem-memory validate
```

`validate` exits non-zero on any problem, so it fits in a pre-commit hook or CI.

## Entry format

Entries live at `memory/<type>s/<slug>.md`. The `id` of an entry is its file
slug. Each file starts with YAML frontmatter:

```markdown
---
type: decision          # decision | convention | limitation | learning | context
title: Use PostgreSQL as the primary data store
status: accepted        # draft | accepted | deprecated (default: draft)
date: 2026-01-15        # ISO date
scope: project          # project (default, repo-wide) or a module name (db, auth…)
author: platform-team   # optional
tags: [database, architecture]
related_paths:          # globs this entry relates to
  - "src/db/**"
  - "migrations/**"
# supersedes: old-entry-id        # optional
# last_verified: 2026-02-01       # optional
---

We chose PostgreSQL because the domain is relational and we rely on
transactional guarantees across several tables.
```

| Field           | Required | Notes                                             |
|-----------------|----------|---------------------------------------------------|
| `type`          | yes      | One of decision, convention, limitation, learning, context |
| `title`         | yes      | Human-readable title; the slug is derived from it |
| `status`        | no       | Defaults to `draft`                               |
| `date`          | yes      | ISO date (`YYYY-MM-DD`)                            |
| `scope`         | no       | Free text; defaults to `project`. Use a module name (`db`, `auth`…) for module-specific entries. Complements `related_paths`. |
| `author`        | no       | Freeform                                          |
| `tags`          | no       | Defaults to `[]`                                  |
| `related_paths` | no       | Globs; power `memory_for_path`. Defaults to `[]`  |
| `supersedes`    | no       | Id of an entry this one replaces                  |
| `last_verified` | no       | ISO date                                          |

## Tools

| Tool                | What it does                                                                 |
|---------------------|------------------------------------------------------------------------------|
| `search_memory`     | Full-text search returning compact summaries (id, type, title, status, snippet). Excludes deprecated by default. Optional `type` and `tags` (OR) filters. |
| `get_memory`        | Returns the full content of one entry by `id`.                               |
| `memory_for_path`   | Returns entries whose `related_paths` globs match a file path. Prioritizes accepted over draft; excludes deprecated. |
| `propose_memory`    | Creates a new entry, **always as `draft`**. Rejects duplicates, never overwrites. |
| `deprecate_memory`  | Marks an entry `deprecated`, recording a reason and optional `superseded_by`. |

## The propose-then-review workflow

1. While working, an AI assistant proposes an entry with `propose_memory`. It
   lands on disk as `status: draft`.
2. The draft shows up in your working tree as a normal file change.
3. You review it in the **same pull request** as the related code, edit if
   needed, and flip `status` to `accepted`.
4. `npx --package @repomem/memory repomem-memory validate` runs in CI to catch
   malformed entries, dangling `supersedes` references, and accidentally
   committed secrets.

Nothing becomes "accepted" memory without a human in the loop.

## Root discovery

The memory root is resolved in this order:

1. `--root <dir>` flag
2. `MEMORY_ROOT` environment variable
3. `<git root>/.repomem/memory`

The server re-checks file modification times before each search, so a
`git pull` is picked up without a restart.

## MCP client config

### Kiro — `.kiro/settings/mcp.json`

```json
{
  "mcpServers": {
    "repomem-memory": {
      "command": "npx",
      "args": ["-y", "--package", "@repomem/memory", "repomem-memory", "serve"],
      "env": {},
      "disabled": false,
      "autoApprove": ["search_memory", "get_memory", "memory_for_path"]
    }
  }
}
```

Instead of writing this by hand, run the one-step setup:

```bash
npx --package @repomem/memory repomem-memory setup --agent kiro   # from your repository root
```

Or configure both repomem servers at once with the installer: `npx @repomem/cli setup`.

It installs a `repomem-memory` skill (how to record and recall memory), a
`repomem-distill` skill (how to distill a finished plan into durable entries as
its final step), an `agentSpawn` validate hook, a shared
`.kiro/agents/repomem.json` agent config, and merges the server into
`.kiro/settings/mcp.json`. The command is idempotent and never overwrites your
existing entries (pass `--force` to replace repomem's own entry). Only `kiro` is
supported today.

### Claude Code — `.mcp.json`

```json
{
  "mcpServers": {
    "repomem-memory": {
      "command": "npx",
      "args": ["-y", "--package", "@repomem/memory", "repomem-memory", "serve"]
    }
  }
}
```

In both cases the server resolves its memory root from the git repository it
runs in. To point at a specific folder, add `"--root", "/path/to/memory"` to
`args` or set `MEMORY_ROOT` in `env`.

## CLI

```bash
repomem-memory serve [--root <dir>]      # start the MCP server over stdio (what agents invoke)
repomem-memory init [--root <dir>]       # scaffold memory/ with templates and a README
repomem-memory validate [--root <dir>]   # validate frontmatter, supersedes refs, and scan for secrets
repomem-memory setup --agent kiro        # install skills, hooks and MCP config for an agent
```

`validate` returns a non-zero exit code on any error, for use in pre-commit and CI.

`setup` resolves the repository root via `--root` > `REPOMEM_REPO_ROOT` > the
enclosing git root, and writes under `.kiro/`.

## Development

Requires **Node.js 22+**.

```bash
npm install
npm run build      # tsc -> dist/
npm test           # vitest
npm run typecheck
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the branching model, commit
conventions, and the test-driven workflow.

## License

[MIT](./LICENSE)
