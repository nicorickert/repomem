/**
 * fsops.ts — idempotent, non-destructive filesystem and JSON helpers shared by
 * the per-package `setup` commands.
 *
 * The guiding principle mirrors `repomem init`: never clobber a user's file.
 * Every operation records what it did in a {@link SetupReport} so callers can
 * surface a clear created / skipped / merged summary.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Aggregable record of what a setup operation touched. Paths are absolute.
 * - `created`: a new file/dir was written that did not exist before.
 * - `skipped`: an existing file was left untouched.
 * - `merged`:  an existing JSON file was updated in place (keys added/changed).
 */
export interface SetupReport {
  created: string[];
  skipped: string[];
  merged: string[];
}

/** A fresh, empty report. */
export function emptyReport(): SetupReport {
  return { created: [], skipped: [], merged: [] };
}

/** Merge `b` into `a` in place and return `a`. */
export function mergeReports(a: SetupReport, b: SetupReport): SetupReport {
  a.created.push(...b.created);
  a.skipped.push(...b.skipped);
  a.merged.push(...b.merged);
  return a;
}

/** Create a directory (recursively) if it does not already exist. */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Copy `src` to `dest` only when `dest` does not exist. Creates parent
 * directories as needed. Records the outcome in the returned report.
 */
export async function copyIfAbsent(src: string, dest: string): Promise<SetupReport> {
  const report = emptyReport();
  if (existsSync(dest)) {
    report.skipped.push(dest);
    return report;
  }
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
  report.created.push(dest);
  return report;
}

/**
 * Like {@link copyIfAbsent} but marks the destination executable (chmod 0o755)
 * when it is created. Used for hook scripts dropped into `.kiro/hooks/`.
 */
export async function copyExecutable(src: string, dest: string): Promise<SetupReport> {
  const report = await copyIfAbsent(src, dest);
  if (report.created.includes(dest)) {
    await fs.chmod(dest, 0o755);
  }
  return report;
}

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Deep-merge `patch` into `base` without clobbering existing keys unless
 * `force` is set.
 *
 * Rules:
 *  - Keys present only in `patch` are added.
 *  - When both sides hold plain objects, merge recursively.
 *  - When a key already exists in `base` with a non-object value (or the two
 *    sides disagree on shape), the existing value is kept — unless `force`,
 *    in which case the patch value wins.
 *
 * Returns a new object; inputs are not mutated.
 */
export function deepMergeAdditive(base: Json, patch: Json, force: boolean): Json {
  const out: Json = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      out[key] = deepMergeAdditive(baseValue, patchValue, force);
    } else if (!(key in out)) {
      out[key] = patchValue;
    } else if (force) {
      out[key] = patchValue;
    }
    // else: key exists and not force → keep existing value.
  }
  return out;
}

/**
 * Read `destPath` as JSON (treating a missing file as `{}`), deep-merge
 * `patch` additively, and write the result back pretty-printed.
 *
 * Records `created` when the file did not exist, otherwise `merged`.
 */
export async function mergeJsonAdditive(
  destPath: string,
  patch: Json,
  options: { force?: boolean } = {},
): Promise<SetupReport> {
  const report = emptyReport();
  const force = options.force ?? false;

  const existed = existsSync(destPath);
  let base: Json = {};
  if (existed) {
    const raw = await fs.readFile(destPath, "utf8");
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        throw new Error(`Expected a JSON object at ${destPath}`);
      }
      base = parsed;
    }
  }

  const merged = deepMergeAdditive(base, patch, force);
  await ensureDir(path.dirname(destPath));
  await fs.writeFile(destPath, JSON.stringify(merged, null, 2) + "\n", "utf8");

  if (existed) report.merged.push(destPath);
  else report.created.push(destPath);
  return report;
}
