# @repomem/core

Shared setup toolkit for the [`@repomem`](https://github.com/nicorickert/repomem)
packages. It is agent-infrastructure only — it knows nothing about the memory or
structure-map domains.

Consumed by [`@repomem/memory`](https://www.npmjs.com/package/@repomem/memory)
and [`@repomem/map`](https://www.npmjs.com/package/@repomem/map) to install
skills, hooks and MCP config into an agent workspace (Kiro today).

## What it provides

- **Idempotent filesystem helpers** (`copyIfAbsent`, `copyExecutable`,
  `ensureDir`, `mergeJsonAdditive`, `deepMergeAdditive`, report helpers) that
  never clobber a user's files.
- **`installForKiro(spec, repoRoot)`** — wires an `AgentSetupSpec` (MCP server,
  skills, hooks) into `.kiro/` additively.
- **`runSetup(spec, args, io)`** — the shared `setup` subcommand body used by
  each package's CLI.
- **`resolveRepoRoot` / `findGitRoot`** — repository root discovery.

Each consumer supplies its own `AgentSetupSpec`; this package performs the
agent-agnostic work.

## Install

```sh
npm install @repomem/core
```

Requires Node.js >= 22.

## License

MIT
