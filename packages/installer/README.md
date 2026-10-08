# @repomem/cli

**One-command installer for [repomem](https://github.com/nicorickert/repomem).**

`@repomem/cli` wires the repomem MCP servers into your AI tool in a single pass.
It is a thin orchestrator over two independent servers:

- [`@repomem/memory`](https://www.npmjs.com/package/@repomem/memory) — your
  repo's reviewable markdown memory, searchable over MCP.
- [`@repomem/map`](https://www.npmjs.com/package/@repomem/map) — a structure map
  and dependency graph (optional companion).

You do not need to install anything: `npx` fetches everything on demand.

## Usage

Interactive — choose which servers to configure and for which agent:

```bash
npx @repomem/cli setup
```

Non-interactive — pass the agent and the servers (handy for CI and scripts):

```bash
npx @repomem/cli setup --agent kiro --servers all        # both servers
npx @repomem/cli setup --agent kiro --servers memory     # just memory
npx @repomem/cli setup --agent kiro --servers memory,map # explicit list
```

### Options

| Flag | Description |
|---|---|
| `--agent <name>` | Target agent. Supported today: `kiro`. |
| `--servers <list>` | Comma-separated server ids (`memory`, `map`) or `all`. |
| `--root <dir>` | Repository root to write `.kiro/` into. Defaults to the enclosing git root. |
| `--force` | Overwrite repomem's own existing entries (never touches foreign keys). |

When both `--agent` and `--servers` are provided, the installer runs
non-interactively. Otherwise it opens an interactive menu.

## What it does

For each selected server, the installer runs that package's own `setup`,
writing (idempotently, under the repository root):

- `.kiro/skills/<id>/SKILL.md` — the server's skill(s)
- `.kiro/hooks/<name>` — hook scripts (memory only)
- `.kiro/agents/repomem.json` — a shared `repomem` agent accumulating both servers
- `.kiro/settings/mcp.json` — the MCP server entries

All writes are additive and non-destructive: existing files are left untouched
(or merged, for JSON) unless `--force` is set.

## Configuring a single server directly

You can skip the installer and configure one server at a time:

```bash
npx --package @repomem/memory repomem-memory setup --agent kiro
npx --package @repomem/map    repomem-map    setup --agent kiro
```

## License

[MIT](LICENSE)
