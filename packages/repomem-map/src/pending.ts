/**
 * pending.ts — compute which files need an (re)generated summary.
 *
 * A file is pending when it has no summary yet, or when its current content
 * hash differs from the hash stored in its summary (stale). No LLM calls here.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { scan } from "./scan.js";
import { hashContent, readSummary } from "./summary.js";

/** A file awaiting a summary, with the hash of its current content. */
export interface PendingFile {
  path: string;
  hash: string;
}

/** Return the files under `root` that are missing a summary or are stale. */
export async function pending(root: string): Promise<PendingFile[]> {
  const files = await scan(root);
  const out: PendingFile[] = [];
  for (const rel of files) {
    const content = await fs.readFile(path.join(root, rel), "utf8");
    const hash = hashContent(content);
    const existing = await readSummary(root, rel);
    if (!existing || existing.hash !== hash) {
      out.push({ path: rel, hash });
    }
  }
  return out;
}
