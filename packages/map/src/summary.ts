/**
 * summary.ts — the on-disk summary record for a single source file.
 *
 * One JSON per source file lives under `.repomem/map/summaries/`, mirroring
 * the code path (e.g. `src/db/client.ts` -> `.repomem/map/summaries/src/db/client.ts.json`).
 * These files are the only map data committed to the repo; everything else
 * (index, staleness) is derived in memory at runtime.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** The committed summary for one source file. */
export interface SummaryRecord {
  /** sha256 hex digest of the source file content this summary was built from. */
  hash: string;
  /** Agent-written description of what the file is about. */
  summary: string;
  /** Terms to help retrieval. */
  search_terms: string[];
  /** Which model produced it; "agent" when the invoking agent generated it. */
  model: string;
  /** ISO timestamp of generation. */
  generated_at: string;
}

/** Directory (relative to a repo root) where summaries are stored. */
export const SUMMARIES_DIR = path.join(".repomem", "map", "summaries");

/** sha256 hex digest of a file's content. Stable and deterministic. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Absolute path of the summary JSON mirroring a repo-relative code path. */
export function summaryPathFor(root: string, codePath: string): string {
  return path.join(root, SUMMARIES_DIR, `${codePath}.json`);
}

/** Write a summary record as pretty JSON, creating parent dirs as needed. */
export async function writeSummary(
  root: string,
  codePath: string,
  record: SummaryRecord,
): Promise<void> {
  const dest = summaryPathFor(root, codePath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, JSON.stringify(record, null, 2) + "\n", "utf8");
}

/** Read a summary record, or null if none exists for the given code path. */
export async function readSummary(
  root: string,
  codePath: string,
): Promise<SummaryRecord | null> {
  const src = summaryPathFor(root, codePath);
  try {
    const raw = await fs.readFile(src, "utf8");
    return JSON.parse(raw) as SummaryRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
