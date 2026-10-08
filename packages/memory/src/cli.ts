#!/usr/bin/env node
/**
 * cli.ts — `repomem-memory` command line.
 *
 *   repomem-memory serve [--root <dir>]      start the MCP server over stdio
 *   repomem-memory init [--root <dir>]       scaffold the memory/ folder + templates
 *   repomem-memory validate [--root <dir>]   check frontmatter, supersedes refs, secrets
 *   repomem-memory setup --agent <name>      install skills, hooks and MCP config
 *
 * `validate` exits non-zero on any error so it can gate pre-commit and CI.
 */

import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveMemoryRoot } from "./store.js";
import { validateRoot, formatReport } from "./validate.js";
import { scaffoldMemory } from "./scaffold.js";
import { main as startServer } from "./index.js";
import { runSetup } from "@repomem/core";
import { repomemSpec } from "./setup/spec.js";

function out(message: string): void {
  process.stdout.write(message + "\n");
}
function err(message: string): void {
  process.stderr.write(message + "\n");
}

function parseFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function cmdInit(root: string): Promise<number> {
  await scaffoldMemory(root, { out, err });
  return 0;
}

async function cmdValidate(root: string): Promise<number> {
  if (!existsSync(root)) {
    err(`No memory folder at ${root}. Run \`repomem-memory init\` first.`);
    return 1;
  }
  const report = await validateRoot(root);
  const text = formatReport(report, root);
  if (report.ok) {
    out(text);
    return 0;
  }
  err(text);
  return 1;
}

function usage(): void {
  out(
    [
      "repomem-memory — your repo's memory for AI tools",
      "",
      "Usage:",
      "  repomem-memory serve [--root <dir>]      Start the MCP server over stdio (default for agents)",
      "  repomem-memory init [--root <dir>]       Scaffold the memory/ folder and templates",
      "  repomem-memory validate [--root <dir>]   Validate entries (frontmatter, refs, secrets)",
      "  repomem-memory setup --agent <name>      Install skills, hooks and MCP config (also scaffolds memory/; --no-init to skip)",
      "",
      "Root resolution: --root > MEMORY_ROOT env > <git root>/.repomem/memory",
      "setup root resolution: --root > REPOMEM_REPO_ROOT env > <git root>",
    ].join("\n"),
  );
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    usage();
    return command ? 0 : 1;
  }

  // `setup` resolves the repository root (not the memory root), so handle it
  // before the memory-root resolution below.
  if (command === "setup") {
    return runSetup(
      repomemSpec,
      {
        agent: parseFlag(argv, "--agent"),
        rootFlag: parseFlag(argv, "--root"),
        force: hasFlag(argv, "--force"),
        skipPostSetup: hasFlag(argv, "--no-init"),
      },
      { out, err },
    );
  }

  // `serve` starts the MCP server over stdio. This is what agents invoke
  // through the generated mcp.json. It resolves its own memory root and runs
  // until the transport closes, so it never returns a non-zero code here.
  if (command === "serve") {
    await startServer(argv.slice(1));
    return 0;
  }

  let root: string;
  try {
    root = resolveMemoryRoot({ rootFlag: parseFlag(argv, "--root") });
  } catch (e) {
    err((e as Error).message);
    return 1;
  }

  switch (command) {
    case "init":
      return cmdInit(root);
    case "validate":
      return cmdValidate(root);
    default:
      err(`Unknown command: ${command}`);
      usage();
      return 1;
  }
}

// Only auto-run when invoked directly (not when imported by tests).
// Only auto-run when invoked directly (not when imported by tests).
// Resolve symlinks on both sides so a globally-installed bin (a symlink to
// dist/cli.js) still matches and the CLI actually runs.
function isInvokedDirectly(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  run()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      err(`fatal: ${(e as Error).message}`);
      process.exit(1);
    });
}
