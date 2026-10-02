/**
 * search.ts — in-memory MiniSearch index over memory entries.
 *
 * The index is rebuilt whenever the set of files or any file's mtime changes,
 * so a `git pull` is picked up without restarting the server. Deprecated
 * entries are excluded from results by default.
 *
 * Rebuild strategy (phase 3): full rebuild on any change. Adequate for the
 * expected scale (hundreds to low thousands of entries).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import {
  TYPE_DIRS,
  ENTRY_TYPES,
  type EntryType,
  type MemoryEntry,
} from "./schema.js";
import { loadEntries } from "./store.js";

/** Short result shape returned by search — kept small for the context window. */
export interface SearchHit {
  id: string;
  type: EntryType;
  title: string;
  status: string;
  snippet: string;
}

export interface SearchQuery {
  query: string;
  type?: EntryType;
  /** OR semantics: an entry matches if it has at least one of these tags. */
  tags?: string[];
  /** Include deprecated entries. Defaults to false. */
  includeDeprecated?: boolean;
  /** Max hits to return. Defaults to 20. */
  limit?: number;
}

const SNIPPET_MAX = 200;
const DEFAULT_LIMIT = 20;

/** Build a short, single-line snippet from an entry body. */
export function makeSnippet(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_MAX) return flat;
  return flat.slice(0, SNIPPET_MAX).trimEnd() + "\u2026";
}

/** Internal document shape fed to MiniSearch. */
interface IndexDoc {
  id: string;
  title: string;
  body: string;
  tags: string;
  // stored fields (not tokenized):
  type: EntryType;
  status: string;
  snippet: string;
  rawTags: string[];
}

function toDoc(entry: MemoryEntry): IndexDoc {
  return {
    id: entry.id,
    title: entry.frontmatter.title,
    body: entry.body,
    tags: entry.frontmatter.tags.join(" "),
    type: entry.frontmatter.type,
    status: entry.frontmatter.status,
    snippet: makeSnippet(entry.body),
    rawTags: entry.frontmatter.tags,
  };
}

/**
 * Scan the memory root and return a signature of path -> mtimeMs for every
 * entry file. Used to decide whether the index needs rebuilding.
 */
async function scanSignature(root: string): Promise<Map<string, number>> {
  const sig = new Map<string, number>();
  for (const type of ENTRY_TYPES) {
    const dir = path.join(root, TYPE_DIRS[type]);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(dir, name);
      try {
        const st = await fs.stat(full);
        sig.set(full, st.mtimeMs);
      } catch {
        // File vanished between readdir and stat — ignore.
      }
    }
  }
  return sig;
}

function sameSignature(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

/**
 * A search index bound to a memory root. Rebuilds itself lazily when the
 * underlying files change (by path set or mtime).
 */
export class MemoryIndex {
  private readonly root: string;
  private mini: MiniSearch<IndexDoc> | undefined;
  private signature = new Map<string, number>();
  private byId = new Map<string, MemoryEntry>();

  constructor(root: string) {
    this.root = root;
  }

  /** All entries currently loaded (after any needed refresh). */
  async entries(): Promise<MemoryEntry[]> {
    await this.refreshIfChanged();
    return [...this.byId.values()];
  }

  /** Look up a single entry by id, or undefined. */
  async get(id: string): Promise<MemoryEntry | undefined> {
    await this.refreshIfChanged();
    return this.byId.get(id);
  }

  /** Rebuild the index if the file signature changed since last time. */
  async refreshIfChanged(): Promise<void> {
    const sig = await scanSignature(this.root);
    if (this.mini && sameSignature(sig, this.signature)) return;
    await this.rebuild(sig);
  }

  /** Force a full rebuild from disk. */
  async rebuild(sig?: Map<string, number>): Promise<void> {
    const entries = await loadEntries(this.root);
    const mini = new MiniSearch<IndexDoc>({
      fields: ["title", "body", "tags"],
      storeFields: ["type", "status", "snippet", "title", "rawTags"],
      searchOptions: {
        boost: { title: 3, tags: 2, body: 1 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
    const docs = entries.map(toDoc);
    mini.addAll(docs);

    this.mini = mini;
    this.byId = new Map(entries.map((e) => [e.id, e]));
    this.signature = sig ?? (await scanSignature(this.root));
  }

  /**
   * Search entries. Excludes deprecated by default. `tags` uses OR semantics.
   */
  async search(q: SearchQuery): Promise<SearchHit[]> {
    await this.refreshIfChanged();
    if (!this.mini) return [];

    const limit = q.limit ?? DEFAULT_LIMIT;
    const wantTags = q.tags?.filter((t) => t.trim() !== "") ?? [];

    const results = this.mini.search(q.query, {
      filter: (r) => {
        const type = r.type as EntryType;
        const status = r.status as string;
        if (!q.includeDeprecated && status === "deprecated") return false;
        if (q.type && type !== q.type) return false;
        if (wantTags.length > 0) {
          const rawTags = (r.rawTags as string[]) ?? [];
          const hit = wantTags.some((t) => rawTags.includes(t));
          if (!hit) return false;
        }
        return true;
      },
    });

    return results.slice(0, limit).map((r) => ({
      id: r.id as string,
      type: r.type as EntryType,
      title: r.title as string,
      status: r.status as string,
      snippet: r.snippet as string,
    }));
  }
}
