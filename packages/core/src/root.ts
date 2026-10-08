/**
 * root.ts — resolve the repository root for the `setup` commands.
 *
 * This is deliberately distinct from the *memory* root (see store.ts): the
 * `.kiro/` directory lives at the repository root, not inside the memory
 * folder. Precedence:
 *   1. `--root` flag
 *   2. `REPOMEM_REPO_ROOT` env var
 *   3. the enclosing git root
 */

import path from "node:path";
import { findGitRoot } from "./git.js";

export interface ResolveRepoRootOptions {
  /** Explicit `--root` value, if provided on the CLI. */
  rootFlag?: string;
  /** Directory to start git-root discovery from. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment map (injectable for tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the repository root where `.kiro/` should be written.
 * Throws when no flag, env var, or git root can be found.
 */
export function resolveRepoRoot(options: ResolveRepoRootOptions = {}): string {
  const { rootFlag, cwd = process.cwd(), env = process.env } = options;

  if (rootFlag && rootFlag.trim() !== "") return path.resolve(rootFlag);

  const envRoot = env.REPOMEM_REPO_ROOT;
  if (envRoot && envRoot.trim() !== "") return path.resolve(envRoot);

  const gitRoot = findGitRoot(cwd);
  if (gitRoot) return gitRoot;

  throw new Error(
    "Could not resolve a repository root: pass --root or run inside a git repository.",
  );
}
