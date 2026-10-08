/**
 * mapindex.ts — in-memory index over the committed summaries.
 *
 * Loads every summary JSON under `.repomem/map/summaries/`, builds a MiniSearch
 * index over summary text, search terms and path, and answers lookups. Nothing
 * here is persisted; the index is rebuilt from the committed summaries at load.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import MiniSearch from "minisearch";
import { SUMMARIES_DIR, hashContent, type SummaryRecord } from "./summary.js";

/** True when the file content no longer matches the summary's hash. */
export function isStale(record: SummaryRecord, currentContent: string): boolean {
  return record.hash !== hashContent(currentContent);
}

interface IndexedDoc {
  id: string; // code path
  path: string;
  summary: string;
  search_terms: string;
}

export interface SearchHit {
  path: string;
  summary: string;
  score: number;
}

export class MapIndex {
  private readonly records = new Map<string, SummaryRecord>();
  private readonly mini: MiniSearch<IndexedDoc>;

  private constructor() {
    this.mini = new MiniSearch<IndexedDoc>({
      fields: ["summary", "search_terms", "path"],
      storeFields: ["path", "summary"],
    });
  }

  /** Load all summaries under `root` and build the search index. */
  static async load(root: string): Promise<MapIndex> {
    const index = new MapIndex();
    const base = path.join(root, SUMMARIES_DIR);
    const files = await fg("**/*.json", { cwd: base, onlyFiles: true });

    const docs: IndexedDoc[] = [];
    for (const rel of files) {
      const codePath = rel.replace(/\.json$/, "");
      const raw = await fs.readFile(path.join(base, rel), "utf8");
      const record = JSON.parse(raw) as SummaryRecord;
      index.records.set(codePath, record);
      docs.push({
        id: codePath,
        path: codePath,
        summary: record.summary,
        search_terms: record.search_terms.join(" "),
      });
    }
    index.mini.addAll(docs);
    return index;
  }

  /** Full-text search across summaries, search terms and paths. */
  search(query: string): SearchHit[] {
    return this.mini.search(query, { prefix: true, fuzzy: 0.2 }).map((r) => ({
      path: r.path as string,
      summary: r.summary as string,
      score: r.score,
    }));
  }

  /** The stored summary record for a code path, or null if none. */
  get(codePath: string): SummaryRecord | null {
    return this.records.get(codePath) ?? null;
  }
}
