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

/** Python source extensions whose imports resolve by dot-path, not JS rules. */
const PYTHON_EXTENSIONS = [".py", ".pyi"] as const;

/** True when a repo-relative path is a Python source file. */
function isPython(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return (PYTHON_EXTENSIONS as readonly string[]).includes(ext);
}

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

/** Markers whose containing directory is treated as a Python source root. */
const PYTHON_PROJECT_MARKERS = ["pyproject.toml", "setup.py", "setup.cfg"] as const;

export class Resolver {
  private constructor(
    private readonly root: string,
    private readonly files: ReadonlySet<string>,
    private readonly alias: AliasConfig | null,
    /**
     * Repo-relative POSIX directories to try as prefixes when an absolute
     * Python dot-path does not resolve from the repo root. Always includes ""
     * (the root itself) first, so root-relative imports keep working.
     */
    private readonly sourceRoots: readonly string[],
  ) {}

  /** Build a resolver for `root`, reading tsconfig aliases and the file set. */
  static async create(root: string, files?: Iterable<string>): Promise<Resolver> {
    const fileSet = files
      ? new Set([...files].map(toPosix))
      : await Resolver.discoverFiles(root);
    const alias = await Resolver.loadAlias(root);
    const sourceRoots = Resolver.detectSourceRoots(fileSet);
    return new Resolver(root, fileSet, alias, sourceRoots);
  }

  /**
   * Directories that look like Python source roots: those containing a project
   * marker (pyproject.toml / setup.py / setup.cfg). The repo root ("") is
   * always first so root-relative dot-paths are tried before any nested root.
   * Deeper roots come later; order only affects tie-breaking when a dot-path
   * would match under more than one root.
   */
  private static detectSourceRoots(files: ReadonlySet<string>): string[] {
    const roots = new Set<string>([""]);
    for (const file of files) {
      const base = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
      const name = file.slice(file.lastIndexOf("/") + 1);
      if ((PYTHON_PROJECT_MARKERS as readonly string[]).includes(name)) {
        roots.add(base);
      }
    }
    // Shallower roots first (fewer segments), then lexicographic for stability.
    return [...roots].sort((a, b) => {
      const da = a === "" ? 0 : a.split("/").length;
      const db = b === "" ? 0 : b.split("/").length;
      return da - db || a.localeCompare(b);
    });
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
    if (isPython(fromFile)) {
      return this.resolvePython(fromFile, specifier);
    }
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

  /**
   * Resolve a Python import specifier to a repo file.
   *
   * Specifiers are normalized by the Python parser: relative imports keep their
   * leading dots ("." / ".mod" / "..pkg.sub") and absolute imports are plain
   * dot-paths ("pkg.sub.mod"). Relative specifiers resolve against the importing
   * file's package. Absolute specifiers resolve against each detected source
   * root (the repo root plus any directory holding a Python project marker),
   * so `src.*` imports work whether the package sits at the repo root or under
   * a nested project dir like `backend/`. Both forms try a module file
   * (`<path>.py`) and a package (`<path>/__init__.py`).
   */
  private resolvePython(fromFile: string, specifier: string): string | null {
    if (specifier.startsWith(".")) {
      // Count leading dots: 1 = current package, N = (N-1) levels up.
      let dots = 0;
      while (dots < specifier.length && specifier[dots] === ".") dots += 1;
      const rest = specifier.slice(dots); // may be "" or "mod.sub"

      const fromDir = path.dirname(path.join(this.root, fromFile));
      // One dot stays in the current directory; each extra dot goes up one.
      const up = dots - 1;
      const baseDir = path.resolve(fromDir, ...Array(up).fill(".."));
      const target = rest.length > 0
        ? path.join(baseDir, ...rest.split("."))
        : baseDir;
      return this.matchPython(target);
    }
    // Absolute dot-path (e.g. "pkg.sub.mod"). Try it under each known source
    // root: the repo root first (""), then any directory holding a Python
    // project marker (e.g. "backend" when imports are written as "src.*" but
    // the package lives in backend/src). External modules (stdlib, pip) match
    // under no root and resolve to null.
    const segments = specifier.split(".");
    for (const srcRoot of this.sourceRoots) {
      const base = srcRoot === "" ? this.root : path.join(this.root, srcRoot);
      const hit = this.matchPython(path.join(base, ...segments));
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Given an absolute base path (no extension), find the Python file it refers
   * to: a module `<base>.py` or a package `<base>/__init__.py`. Returns a
   * repo-relative POSIX path, or null when neither exists in the repo.
   */
  private matchPython(absBase: string): string | null {
    const candidates = [absBase + ".py", path.join(absBase, "__init__.py")];
    for (const cand of candidates) {
      const rel = toPosix(path.relative(this.root, cand));
      if (this.files.has(rel)) return rel;
    }
    return null;
  }
}
