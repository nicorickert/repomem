# Memory

This folder is your repository's shared memory, read and extended by AI tools
through the `repomem-memory` MCP server.

Each entry is a markdown file with structured frontmatter, organized by type:

- `decisions/`   — choices made and why
- `conventions/` — rules the team follows
- `limitations/` — known constraints and gotchas
- `learnings/`   — lessons worth remembering
- `contexts/`    — project and module-level context (what things are and why)

## How it works

AI tools **propose** new entries as drafts (`status: draft`). A human reviews
and **accepts** them in the same pull request as the related change. Entries are
versioned with git — no external database.

Run `npx --package @repomem/memory repomem-memory validate` to check entries before committing.

See `templates/` for a starting point for each entry type.
