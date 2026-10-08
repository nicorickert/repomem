/**
 * scan.ts — discover candidate source files under a repo root.
 *
 * Returns POSIX-style, repo-relative paths. Excludes dependency, build and
 * VCS directories, and the map's own `.repomem` storage.
 */

import fg from "fast-glob";

/** Directories never scanned for summaries. */
export const IGNORED_DIRS = ["node_modules", "dist", ".git", ".repomem"];

/**
 * List repo-relative file paths under `root`, excluding IGNORED_DIRS.
 * Paths use forward slashes regardless of platform.
 */
export async function scan(root: string): Promise<string[]> {
  const entries = await fg("**/*", {
    cwd: root,
    onlyFiles: true,
    dot: false,
    ignore: IGNORED_DIRS.map((d) => `**/${d}/**`),
  });
  return entries;
}
