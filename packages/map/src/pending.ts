/**
 * pending.ts — compute which files need an (re)generated summary.
 *
 * A file is pending when it has no summary yet, or when its current content
 * hash differs from the hash stored in its summary (stale). No LLM calls here.
 *
 * Cost control: files are examined in order, in small concurrent batches, and
 * the walk stops as soon as `limit` pending files were found. Files above
 * `maxBytes`, and paths that no longer exist or are not regular files (e.g. a
 * tracked file deleted from the working tree, a submodule), are skipped.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { scan } from "./scan.js";
import { hashContent, readSummary } from "./summary.js";

/** Files larger than this are not summarized (generated bundles, dumps, ...). */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

/** How many files are examined concurrently. */
const BATCH = 32;

/** A file awaiting a summary, with the hash of its current content. */
export interface PendingFile {
  path: string;
  hash: string;
}

export interface PendingOptions {
  /** Stop once this many pending files were found. Default: no limit. */
  limit?: number;
  /** Skip files larger than this many bytes. Default {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number;
}

/** Examine one file; null when it is skipped or already has a fresh summary. */
async function examine(
  root: string,
  rel: string,
  maxBytes: number,
): Promise<PendingFile | null> {
  const abs = path.join(root, rel);
  let content: string;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    content = await fs.readFile(abs, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return null;
    throw err;
  }
  const hash = hashContent(content);
  const existing = await readSummary(root, rel);
  return !existing || existing.hash !== hash ? { path: rel, hash } : null;
}

/** Return the files under `root` that are missing a summary or are stale. */
export async function pending(
  root: string,
  options: PendingOptions = {},
): Promise<PendingFile[]> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const files = await scan(root);
  const out: PendingFile[] = [];
  for (let i = 0; i < files.length && out.length < limit; i += BATCH) {
    const batch = await Promise.all(
      files.slice(i, i + BATCH).map((rel) => examine(root, rel, maxBytes)),
    );
    for (const hit of batch) {
      if (hit && out.length < limit) out.push(hit);
    }
  }
  return out;
}
