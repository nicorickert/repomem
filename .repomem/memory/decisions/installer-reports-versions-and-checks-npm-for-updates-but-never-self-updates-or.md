---
type: decision
title: >-
  Installer reports versions and checks npm for updates, but never self-updates
  or pins @latest in MCP config
status: accepted
date: '2026-10-23'
scope: project
tags:
  - installer
  - cli
  - version
  - npx
  - update-check
related_paths:
  - packages/installer/src/version.ts
  - packages/installer/src/run.ts
  - packages/installer/src/cli.ts
  - packages/installer/test/version.test.ts
  - packages/installer/test/run.version.test.ts
---
**Context**: The installer had no way to show its version or tell users that a newer release exists. `npx` caches downloads under `~/.npm/_npx`, and an MCP server process keeps running the code it started with until the client restarts it. Whether a *new* start picks up a newer release depends on the npm version: the libnpmexec source of npm 12.2.0 re-checks the registry for name-only specs in the npx cache (`missingFromTree`, `npxByNameOnly`), so `@repomem/map` and `@repomem/map@latest` behave the same there; older npm versions were not checked. (Earlier wording claimed a stale cached copy was the cause of slow `request_summaries`; that was not verified. The running servers were on 0.1.4, which is the latest published.)

**Decision**: `repomem --version` (alias `-v`) prints the installed versions of `@repomem/cli`, `memory`, `map` and `core`, then queries the public npm registry (`/<pkg>/latest`, 2 s timeout, fail-silent) and marks newer ones with the command `npx @repomem/cli@latest setup`. The interactive menu does the same check once and prints a one-line notice to stderr before prompting. Non-interactive runs (`--agent` + `--servers`) never touch the network. `REPOMEM_NO_UPDATE_CHECK=1` disables every lookup. The lookup is injected into `runInstaller` (`versions.latest`), so tests never hit the network and omitting it means no check.

**Rejected**: (B) relaunching itself with `@latest` automatically, because running freshly downloaded code without the user choosing is a supply-chain risk; (C) writing `@latest` into the generated MCP server config, because on npm 12 it adds nothing over the current unpinned spec (both re-check), it would still not update an already running server, it changes args that are pinned by tests in core/memory/map and already written into user repos, and a registry check at start-up costs time and can fail offline. It may still help on older npm; not verified.

**Limitations**: The registry is hardcoded to `registry.npmjs.org` (private registries / `.npmrc` are ignored). Versions of memory/map/core are what this installation resolved, not what the target repo's `.kiro/settings/mcp.json` runs. Not verified: the "outdated" path against the real registry (only unit-tested with stubs); the live call only confirmed "Up to date".
