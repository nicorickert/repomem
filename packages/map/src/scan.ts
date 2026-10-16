/**
 * scan.ts — discover candidate source files under a repo root.
 *
 * Returns POSIX-style, repo-relative paths. Excludes dependency, build and
 * VCS directories, and the map's own `.repomem` storage.
 */

import fg from "fast-glob";

/**
 * Directories never scanned for summaries or the dependency graph. They hold
 * VCS metadata, installed dependencies, build output or tool caches — large,
 * generated, and never part of the repo's own structure. Matched at any depth.
 */
export const IGNORED_DIRS = [
  // VCS, editor and repomem's own storage
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".repomem",
  // Installed dependencies
  "node_modules",
  "bower_components",
  "vendor",
  ".venv",
  "venv",
  "site-packages",
  // Build output
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".gradle",
  // Caches and reports
  ".cache",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  ".terraform",
  "coverage",
];

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
