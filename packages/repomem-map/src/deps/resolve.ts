/**
 * resolve.ts — turn raw module specifiers into repo-relative file paths.
 *
 * Handles the two kinds of imports that point at files inside the repo:
 *   - relative specifiers (./x, ../y) with implicit extensions and index.*
 *   - tsconfig path aliases (baseUrl + paths, e.g. "@/*" -> "src/*")
 *
 * Everything else — Node builtins and npm packages — resolves to null, so the
 * graph only ever contains edges between files that actually exist in the repo.
 * Resolution is validated against the real set of files on disk; the alias
 * config is read once from the root tsconfig.json and cached on the instance.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/** Extensions tried, in order, when a specifier has no real extension. */
const IMPLICIT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

/** Extensions a specifier may carry that we strip to find the TS source. */
const REWRITABLE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"] as const;

interface AliasConfig {
  /** Absolute base directory for non-relative alias resolution. */
  baseDir: string;
  /** Alias patterns from tsconfig `paths`, prefix-matched. */
  paths: Array<{ prefix: string; targets: string[]; wildcard: boolean }>;
}

/** Convert any path to POSIX-style, repo-relative form. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export class Resolver {
  private constructor(
    private readonly root: string,
    private readonly files: ReadonlySet<string>,
    private readonly alias: AliasConfig | null,
  ) {}

  /** Build a resolver for `root`, reading tsconfig aliases and the file set. */
  static async create(root: string, files?: Iterable<string>): Promise<Resolver> {
    const fileSet = files
      ? new Set([...files].map(toPosix))
      : await Resolver.discoverFiles(root);
    const alias = await Resolver.loadAlias(root);
    return new Resolver(root, fileSet, alias);
  }

  private static async discoverFiles(root: string): Promise<Set<string>> {
    const { scan } = await import("../scan.js");
    return new Set((await scan(root)).map(toPosix));
  }

  private static async loadAlias(root: string): Promise<AliasConfig | null> {
    const tsconfigPath = path.join(root, "tsconfig.json");
    let raw: string;
    try {
      raw = await fs.readFile(tsconfigPath, "utf8");
    } catch {
      return null;
    }
    let json: {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
    const opts = json.compilerOptions ?? {};
    const baseUrl = opts.baseUrl ?? ".";
    const baseDir = path.resolve(root, baseUrl);
    const paths = Object.entries(opts.paths ?? {}).map(([key, targets]) => {
      const wildcard = key.endsWith("/*") || key.includes("*");
      return {
        prefix: key.replace(/\*$/, ""),
        targets: targets.map((t) => t.replace(/\*$/, "")),
        wildcard,
      };
    });
    return { baseDir, paths };
  }

  /**
   * Resolve `specifier` imported from repo-relative `fromFile` to a
   * repo-relative POSIX path, or null when it points outside the repo.
   */
  resolve(fromFile: string, specifier: string): string | null {
    if (specifier.startsWith(".")) {
      const fromDir = path.dirname(path.join(this.root, fromFile));
      const abs = path.resolve(fromDir, specifier);
      return this.matchFile(abs);
    }
    // Non-relative: try tsconfig aliases; otherwise it's external.
    if (this.alias) {
      const aliased = this.resolveAlias(specifier);
      if (aliased) return aliased;
    }
    return null;
  }

  private resolveAlias(specifier: string): string | null {
    if (!this.alias) return null;
    for (const { prefix, targets, wildcard } of this.alias.paths) {
      if (wildcard) {
        if (!specifier.startsWith(prefix)) continue;
        const rest = specifier.slice(prefix.length);
        for (const target of targets) {
          const abs = path.resolve(this.alias.baseDir, target + rest);
          const hit = this.matchFile(abs);
          if (hit) return hit;
        }
      } else if (specifier === prefix.replace(/\/$/, "")) {
        for (const target of targets) {
          const abs = path.resolve(this.alias.baseDir, target);
          const hit = this.matchFile(abs);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  /**
   * Given an absolute path (possibly without extension), find the real repo
   * file it refers to: exact match, rewritten .js->.ts, implicit extension, or
   * an index file inside a directory. Returns a repo-relative POSIX path.
   */
  private matchFile(abs: string): string | null {
    const candidates: string[] = [];

    const ext = path.extname(abs);
    if (ext) {
      candidates.push(abs);
      // import "./a.js" commonly means the "./a.ts" source.
      if ((REWRITABLE_EXTENSIONS as readonly string[]).includes(ext)) {
        const stem = abs.slice(0, -ext.length);
        for (const e of IMPLICIT_EXTENSIONS) candidates.push(stem + e);
      }
    } else {
      for (const e of IMPLICIT_EXTENSIONS) candidates.push(abs + e);
      for (const e of IMPLICIT_EXTENSIONS) candidates.push(path.join(abs, "index" + e));
    }

    for (const cand of candidates) {
      const rel = toPosix(path.relative(this.root, cand));
      if (this.files.has(rel)) return rel;
    }
    return null;
  }
}
