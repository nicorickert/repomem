/**
 * git.ts — repository discovery helpers shared across @repomem packages.
 */

import path from "node:path";
import { existsSync } from "node:fs";

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
