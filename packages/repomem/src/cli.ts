#!/usr/bin/env node
/**
 * cli.ts — `repomem init` and `repomem validate`.
 *
 *   repomem init [--root <dir>]       scaffold the memory/ folder + templates
 *   repomem validate [--root <dir>]   check frontmatter, supersedes refs, secrets
 *
 * `validate` exits non-zero on any error so it can gate pre-commit and CI.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRY_TYPES, TYPE_DIRS } from "./schema.js";
import { resolveMemoryRoot } from "./store.js";
import { validateRoot, formatReport } from "./validate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Templates ship alongside dist/ at the package root: dist/cli.js -> ../templates
const TEMPLATES_DIR = path.resolve(here, "..", "templates");

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

const MEMORY_README = `# Memory

This folder is your repository's shared memory, read and extended by AI tools
through the \`repomem\` MCP server.

Each entry is a markdown file with structured frontmatter, organized by type:

- \`decisions/\`   — choices made and why
- \`conventions/\` — rules the team follows
- \`limitations/\` — known constraints and gotchas
- \`learnings/\`   — lessons worth remembering

## How it works

AI tools **propose** new entries as drafts (\`status: draft\`). A human reviews
and **accepts** them in the same pull request as the related change. Entries are
versioned with git — no external database.

Run \`npx repomem validate\` to check entries before committing.

See \`templates/\` for a starting point for each entry type.
`;

async function cmdInit(root: string): Promise<number> {
  const created: string[] = [];
  const skipped: string[] = [];

  async function ensureDir(dir: string): Promise<void> {
    if (existsSync(dir)) {
      skipped.push(dir);
    } else {
      await fs.mkdir(dir, { recursive: true });
      created.push(dir);
    }
  }

  await ensureDir(root);
  for (const type of ENTRY_TYPES) {
    await ensureDir(path.join(root, TYPE_DIRS[type]));
  }

  // README (never overwrite).
  const readme = path.join(root, "README.md");
  if (existsSync(readme)) {
    skipped.push(readme);
  } else {
    await fs.writeFile(readme, MEMORY_README, "utf8");
    created.push(readme);
  }

  // Templates (never overwrite individual files).
  const destTemplates = path.join(root, "templates");
  await ensureDir(destTemplates);
  for (const type of ENTRY_TYPES) {
    const src = path.join(TEMPLATES_DIR, `${type}.md`);
    const dest = path.join(destTemplates, `${type}.md`);
    if (existsSync(dest)) {
      skipped.push(dest);
      continue;
    }
    try {
      const content = await fs.readFile(src, "utf8");
      await fs.writeFile(dest, content, "utf8");
      created.push(dest);
    } catch {
      err(`warning: template not found: ${src}`);
    }
  }

  out(`Initialized memory at ${root}`);
  if (created.length) out(`  created:\n${created.map((c) => `    + ${c}`).join("\n")}`);
  if (skipped.length) out(`  already present (left untouched):\n${skipped.map((c) => `    = ${c}`).join("\n")}`);
  return 0;
}

async function cmdValidate(root: string): Promise<number> {
  if (!existsSync(root)) {
    err(`No memory folder at ${root}. Run \`repomem init\` first.`);
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
      "repomem — your repo's memory for AI tools",
      "",
      "Usage:",
      "  repomem init [--root <dir>]       Scaffold the memory/ folder and templates",
      "  repomem validate [--root <dir>]   Validate entries (frontmatter, refs, secrets)",
      "",
      "Root resolution: --root > MEMORY_ROOT env > <git root>/.repomem/memory",
    ].join("\n"),
  );
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    usage();
    return command ? 0 : 1;
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
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  run()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      err(`fatal: ${(e as Error).message}`);
      process.exit(1);
    });
}
