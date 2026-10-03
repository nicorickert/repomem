/**
 * store.ts — read and write memory entries on disk.
 *
 * Responsibilities:
 *  - Resolve the memory root: `--root` flag > `MEMORY_ROOT` env > <git root>/.repomem/memory.
 *  - Load entries from `memory/<type>s/<slug>.md`, skipping (not crashing on)
 *    malformed files and reporting them to stderr.
 *  - Generate ASCII slugs from titles and write entries without ever
 *    overwriting an existing file.
 *  - Propose new draft entries (reject duplicates), deprecate existing ones
 *    in place, and find entries whose related_paths match a given file path.
 *
 * Never writes to stdout — diagnostics go to stderr only, to keep the MCP
 * stdio protocol clean.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import picomatch from "picomatch";
import {
  frontmatterSchema,
  TYPE_DIRS,
  ENTRY_TYPES,
  type EntryType,
  type Frontmatter,
  type FrontmatterInput,
  type MemoryEntry,
} from "./schema.js";

/** Log a diagnostic to stderr. Never use stdout (reserved for MCP). */
function warn(message: string): void {
  process.stderr.write(`[repomem] ${message}\n`);
}

/** Today's date in UTC as `YYYY-MM-DD`. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Root discovery
// ---------------------------------------------------------------------------

export interface ResolveRootOptions {
  /** Explicit `--root` value, if provided on the CLI. */
  rootFlag?: string;
  /** Directory to start git-root discovery from. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment map (injectable for tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Walk upward from `start` looking for a `.git` entry (dir or file).
 * Returns the directory containing it, or undefined if none is found.
 */
export function findGitRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolve the memory root using the precedence:
 *   1. `--root` flag
 *   2. `MEMORY_ROOT` env var
 *   3. `<git root>/.repomem/memory`
 *
 * Throws if none can be resolved (no flag, no env, no git root found).
 */
export function resolveMemoryRoot(options: ResolveRootOptions = {}): string {
  const { rootFlag, cwd = process.cwd(), env = process.env } = options;

  if (rootFlag && rootFlag.trim() !== "") return path.resolve(rootFlag);

  const envRoot = env.MEMORY_ROOT;
  if (envRoot && envRoot.trim() !== "") return path.resolve(envRoot);

  const gitRoot = findGitRoot(cwd);
  if (gitRoot) return path.join(gitRoot, ".repomem", "memory");

  throw new Error(
    "Could not resolve a memory root: pass --root, set MEMORY_ROOT, or run inside a git repository.",
  );
}

// ---------------------------------------------------------------------------
// Slug generation (option A: ASCII, diacritics stripped)
// ---------------------------------------------------------------------------

const SLUG_MAX_LENGTH = 80;

/**
 * Convert a title into an ASCII, URL-safe slug.
 * Strips diacritics (á -> a), lowercases, replaces non-alphanumerics with
 * single hyphens, trims hyphens, and caps length.
 */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Build a slug that does not collide with `existing`. Appends `-2`, `-3`, …
 * until unique. Returns the input slug when there is no collision.
 */
export function uniqueSlug(slug: string, existing: ReadonlySet<string>): string {
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function typeDir(root: string, type: EntryType): string {
  return path.join(root, TYPE_DIRS[type]);
}

/** The slug (id) is the file name without its `.md` extension. */
function slugFromFile(file: string): string {
  return path.basename(file, ".md");
}

/**
 * Parse a single entry file. Returns the entry, or undefined if the file is
 * malformed (invalid frontmatter, wrong type for its folder). Malformed files
 * are reported to stderr and skipped rather than throwing.
 */
export async function readEntryFile(
  file: string,
  expectedType?: EntryType,
): Promise<MemoryEntry | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    warn(`could not read ${file}: ${(err as Error).message}`);
    return undefined;
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    warn(`invalid frontmatter in ${file}: ${(err as Error).message}`);
    return undefined;
  }

  const result = frontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    warn(`skipping ${file}: ${issues}`);
    return undefined;
  }

  const frontmatter = result.data;

  if (expectedType && frontmatter.type !== expectedType) {
    warn(
      `skipping ${file}: declared type "${frontmatter.type}" does not match folder "${TYPE_DIRS[expectedType]}"`,
    );
    return undefined;
  }

  return {
    id: slugFromFile(file),
    frontmatter,
    body: parsed.content.trim(),
    path: file,
  };
}

/**
 * Load all valid entries under the memory root. Missing type folders are
 * treated as empty. Malformed entries are skipped (reported to stderr).
 */
export async function loadEntries(root: string): Promise<MemoryEntry[]> {
  const entries: MemoryEntry[] = [];

  for (const type of ENTRY_TYPES) {
    const dir = typeDir(root, type);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const name of files) {
      if (!name.endsWith(".md")) continue;
      const entry = await readEntryFile(path.join(dir, name), type);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

/** Find a single entry by id across all type folders, or undefined. */
export async function findEntryById(
  root: string,
  id: string,
): Promise<MemoryEntry | undefined> {
  for (const type of ENTRY_TYPES) {
    const file = path.join(typeDir(root, type), `${id}.md`);
    if (existsSync(file)) {
      return readEntryFile(file, type);
    }
  }
  return undefined;
}

/** Collect the set of existing slugs for a given type (for collision checks). */
export async function existingSlugs(
  root: string,
  type: EntryType,
): Promise<Set<string>> {
  const dir = typeDir(root, type);
  try {
    const files = await fs.readdir(dir);
    return new Set(
      files.filter((f) => f.endsWith(".md")).map((f) => slugFromFile(f)),
    );
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize frontmatter + body back into a markdown file string.
 * Keys are written in a stable, human-friendly order; optional keys are only
 * emitted when present.
 */
export function serializeEntry(frontmatter: Frontmatter, body: string): string {
  const data: Record<string, unknown> = {
    type: frontmatter.type,
    title: frontmatter.title,
    status: frontmatter.status,
    date: frontmatter.date,
  };
  if (frontmatter.author !== undefined) data.author = frontmatter.author;
  data.tags = frontmatter.tags;
  data.related_paths = frontmatter.related_paths;
  if (frontmatter.supersedes !== undefined) data.supersedes = frontmatter.supersedes;
  if (frontmatter.last_verified !== undefined) {
    data.last_verified = frontmatter.last_verified;
  }
  if (frontmatter.deprecated_reason !== undefined) {
    data.deprecated_reason = frontmatter.deprecated_reason;
  }
  if (frontmatter.superseded_by !== undefined) {
    data.superseded_by = frontmatter.superseded_by;
  }

  return matter.stringify(body.trim() + "\n", data);
}

// ---------------------------------------------------------------------------
// Writing (create)
// ---------------------------------------------------------------------------

export interface WriteResult {
  id: string;
  path: string;
}

/**
 * Write a new entry to disk. Validates frontmatter, resolves a unique slug
 * from the title, creates the type folder if needed, and NEVER overwrites an
 * existing file. Returns the id and path written.
 *
 * @throws if frontmatter is invalid or the resolved file already exists.
 */
export async function writeEntry(
  root: string,
  input: FrontmatterInput,
  body: string,
): Promise<WriteResult> {
  const frontmatter = frontmatterSchema.parse(input);
  const dir = typeDir(root, frontmatter.type);
  await fs.mkdir(dir, { recursive: true });

  const taken = await existingSlugs(root, frontmatter.type);
  const slug = uniqueSlug(slugify(frontmatter.title), taken);
  const file = path.join(dir, `${slug}.md`);

  if (existsSync(file)) {
    throw new Error(`refusing to overwrite existing entry: ${file}`);
  }

  await fs.writeFile(file, serializeEntry(frontmatter, body), {
    encoding: "utf8",
    flag: "wx",
  });

  return { id: slug, path: file };
}

// ---------------------------------------------------------------------------
// Propose (create a draft; reject duplicates)
// ---------------------------------------------------------------------------

export interface ProposeInput {
  type: EntryType;
  title: string;
  body: string;
  tags?: string[];
  related_paths?: string[];
  supersedes?: string;
  author?: string;
}

/**
 * Propose a new entry. ALWAYS writes `status: draft`. The date defaults to
 * today (UTC). Rejects a title whose slug already exists within the same type
 * (a likely duplicate the human should resolve) rather than auto-suffixing.
 *
 * @throws if the derived slug collides with an existing entry of that type.
 */
export async function proposeEntry(
  root: string,
  input: ProposeInput,
): Promise<WriteResult> {
  const slug = slugify(input.title);
  if (slug === "") {
    throw new Error("title does not produce a usable slug");
  }

  const taken = await existingSlugs(root, input.type);
  if (taken.has(slug)) {
    throw new Error(
      `a ${input.type} entry with id "${slug}" already exists; refusing to create a duplicate`,
    );
  }

  const frontmatter = frontmatterSchema.parse({
    type: input.type,
    title: input.title,
    status: "draft", // forced, never taken from caller
    date: todayIso(),
    author: input.author,
    tags: input.tags ?? [],
    related_paths: input.related_paths ?? [],
    supersedes: input.supersedes,
  });

  const dir = typeDir(root, input.type);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);

  if (existsSync(file)) {
    throw new Error(`refusing to overwrite existing entry: ${file}`);
  }

  await fs.writeFile(file, serializeEntry(frontmatter, input.body), {
    encoding: "utf8",
    flag: "wx",
  });

  return { id: slug, path: file };
}

// ---------------------------------------------------------------------------
// Deprecate (rewrite an existing entry in place)
// ---------------------------------------------------------------------------

/**
 * Mark an existing entry as deprecated, recording the reason (and optionally
 * the id that supersedes it) in the frontmatter. Rewrites the file in place,
 * preserving the body and other fields.
 *
 * @throws if the entry does not exist.
 */
export async function deprecateEntry(
  root: string,
  id: string,
  reason: string,
  supersededBy?: string,
): Promise<WriteResult> {
  if (reason.trim() === "") {
    throw new Error("a deprecation reason is required");
  }

  const entry = await findEntryById(root, id);
  if (!entry) {
    throw new Error(`no memory entry found with id "${id}"`);
  }

  const updated = frontmatterSchema.parse({
    ...entry.frontmatter,
    status: "deprecated",
    deprecated_reason: reason,
    superseded_by: supersededBy,
  });

  await fs.writeFile(entry.path, serializeEntry(updated, entry.body), "utf8");
  return { id: entry.id, path: entry.path };
}

// ---------------------------------------------------------------------------
// memory_for_path (match related_paths globs against a file path)
// ---------------------------------------------------------------------------

const STATUS_PRIORITY: Record<string, number> = {
  accepted: 0,
  draft: 1,
  deprecated: 2,
};

/**
 * Return entries whose `related_paths` globs match the given file path.
 * Deprecated entries are excluded. Results are ordered accepted-before-draft,
 * then by date descending.
 *
 * The input path is normalized to posix separators so globs behave the same
 * across platforms.
 */
export async function entriesForPath(
  root: string,
  filePath: string,
): Promise<MemoryEntry[]> {
  const normalized = filePath.split(path.sep).join("/").replace(/^\.?\/+/, "");
  const entries = await loadEntries(root);

  const matched = entries.filter((e) => {
    if (e.frontmatter.status === "deprecated") return false;
    if (e.frontmatter.related_paths.length === 0) return false;
    return e.frontmatter.related_paths.some((glob) =>
      picomatch.isMatch(normalized, glob, { dot: true }),
    );
  });

  matched.sort((a, b) => {
    const pa = STATUS_PRIORITY[a.frontmatter.status] ?? 99;
    const pb = STATUS_PRIORITY[b.frontmatter.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return b.frontmatter.date.localeCompare(a.frontmatter.date);
  });

  return matched;
}
