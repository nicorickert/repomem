/**
 * scan.ts — discover candidate source files under a repo root.
 *
 * Returns POSIX-style, repo-relative paths. Excludes dependency, build and
 * VCS directories, and the map's own `.repomem` storage.
 */

import fg from "fast-glob";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
 * Extensions of files that are never worth reading as text. Skipped without a
 * `stat`, in both the git and the glob path.
 */
export const BINARY_EXTENSIONS = new Set([
  // images, audio, video, fonts
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tif", "tiff", "psd",
  "mp3", "mp4", "mov", "avi", "mkv", "wav", "flac", "ogg", "webm",
  "woff", "woff2", "ttf", "otf", "eot",
  // archives and packages
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war", "whl",
  // compiled artifacts and native libraries
  "so", "dylib", "dll", "exe", "bin", "o", "a", "lib", "class", "pyc", "pyo", "wasm",
  // documents and data stores
  "pdf", "parquet", "sqlite", "sqlite3", "db",
]);

/** True when `rel` (POSIX, repo-relative) should be considered a candidate file. */
function isCandidate(rel: string): boolean {
  const segments = rel.split("/");
  // Same as the glob's `dot: false`: no path segment may start with ".".
  if (segments.some((s) => s.startsWith("."))) return false;
  for (let i = 0; i < segments.length - 1; i++) {
    if (IGNORED_DIR_SET.has(segments[i] ?? "")) return false;
  }
  const leaf = segments[segments.length - 1] ?? "";
  const dot = leaf.lastIndexOf(".");
  if (dot > 0 && BINARY_EXTENSIONS.has(leaf.slice(dot + 1).toLowerCase())) return false;
  return true;
}

const IGNORED_DIR_SET: ReadonlySet<string> = new Set(IGNORED_DIRS);

/**
 * Ask git for the files that belong to the repo: tracked plus untracked that
 * are not ignored, honouring every `.gitignore` (nested, global, `info/exclude`).
 * Ignored directories are not descended into, so a huge generated tree such as
 * `cdk.out/` costs nothing. Returns null when `root` is not in a git repository
 * or git is unavailable, so the caller can fall back to a glob.
 *
 * Note: a tracked file that was deleted from the working tree is still listed.
 */
async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 },
    );
    // Entries ending in "/" are nested repositories / submodules, not files.
    return stdout.split("\0").filter((p) => p !== "" && !p.endsWith("/"));
  } catch {
    return null;
  }
}

/**
 * List repo-relative file paths under `root`. Inside a git repository the list
 * comes from git and respects `.gitignore`; elsewhere it is a glob. In both
 * cases IGNORED_DIRS, dotfiles/dot-directories and binary extensions are
 * excluded. Paths use forward slashes regardless of platform.
 */
export async function scan(root: string): Promise<string[]> {
  const fromGit = await gitFiles(root);
  if (fromGit) return [...new Set(fromGit.filter(isCandidate))];

  const entries = await fg("**/*", {
    cwd: root,
    onlyFiles: true,
    dot: false,
    ignore: IGNORED_DIRS.map((d) => `**/${d}/**`),
  });
  return entries.filter(isCandidate);
}
