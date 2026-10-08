/**
 * scaffold.ts — create the reviewable `memory/` folder structure.
 *
 * Shared by the `init` CLI command and by the setup `postSetup` hook, so that
 * configuring the memory server also scaffolds its content. Every operation is
 * idempotent and never overwrites an existing file.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SetupIo } from "@repomem/core";
import { ENTRY_TYPES, TYPE_DIRS } from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Templates ship alongside dist/ at the package root: dist/scaffold.js -> ../templates
const TEMPLATES_DIR = path.resolve(here, "..", "templates");

const MEMORY_README = `# Memory

This folder is your repository's shared memory, read and extended by AI tools
through the \`repomem-memory\` MCP server.

Each entry is a markdown file with structured frontmatter, organized by type:

- \`decisions/\`   — choices made and why
- \`conventions/\` — rules the team follows
- \`limitations/\` — known constraints and gotchas
- \`learnings/\`   — lessons worth remembering
- \`contexts/\`    — project and module-level context (what things are and why)

## How it works

AI tools **propose** new entries as drafts (\`status: draft\`). A human reviews
and **accepts** them in the same pull request as the related change. Entries are
versioned with git — no external database.

Run \`npx --package @repomem/memory repomem-memory validate\` to check entries before committing.

See \`templates/\` for a starting point for each entry type.
`;

/**
 * Scaffold the memory folder at `root`: type subdirectories, a README, and the
 * entry templates. Idempotent: existing files are left untouched. Returns the
 * created/skipped paths so callers can print a report.
 */
export async function scaffoldMemory(
  root: string,
  io: SetupIo,
): Promise<{ created: string[]; skipped: string[] }> {
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
      io.err(`warning: template not found: ${src}`);
    }
  }

  io.out(`Initialized memory at ${root}`);
  if (created.length) io.out(`  created:\n${created.map((c) => `    + ${c}`).join("\n")}`);
  if (skipped.length)
    io.out(`  already present (left untouched):\n${skipped.map((c) => `    = ${c}`).join("\n")}`);

  return { created, skipped };
}
