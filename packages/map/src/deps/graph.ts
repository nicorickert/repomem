/**
 * graph.ts — the in-memory file->file dependency graph.
 *
 * Built at startup from the repository (never committed), mirroring how
 * MapIndex loads summaries, then kept current with `sync` (incremental: only
 * changed files are re-read). Nodes are every scannable TS/JS file, whether or
 * not they have a summary, so the graph is a complete, deterministic picture
 * of static imports — the right basis for measuring a change's blast radius.
 *
 * This module provides the graph structure, direct edges and per-node metrics.
 * Transitive blast radius and cycle detection are added in a later step.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { scan } from "../scan.js";
import { parseSource, parserFor } from "./parser.js";
import { Resolver } from "./resolve.js";

/** Structural metrics for a single node. */
export interface NodeMetrics {
  /** Number of files that import this file (reverse edges). */
  fanIn: number;
  /** Number of in-repo files this file imports (forward edges). */
  fanOut: number;
  /** Raw import specifiers declared in the file (incl. external). */
  imports: number;
  /** Exported symbols declared in the file. */
  exports: number;
}

/** Direction of a blast-radius traversal. */
export type ImpactDirection = "dependents" | "dependencies";

/** Options for a blast-radius traversal. */
export interface ImpactOptions {
  /** Which way to walk: who depends on this, or what this depends on. */
  direction: ImpactDirection;
  /** Max hops from the start node. Omit for the full transitive closure. */
  depth?: number;
}

/** One impacted node with its shortest hop distance from the start. */
export interface ImpactedNode {
  path: string;
  distance: number;
}

/** What a `sync` did, so callers (and tests) can see how much work it took. */
export interface SyncReport {
  /** Files that were read and parsed (new or edited), sorted. */
  reparsed: string[];
  /** Code files that left the graph, sorted. */
  removed: string[];
  /** True when every file's imports were re-resolved (from the parse cache). */
  relinked: boolean;
}

/** Cheap change detector for a file: modification time + size, from `stat`. */
interface Signature {
  mtimeMs: number;
  size: number;
  key: string;
}

/** What was extracted from a code file, and the signature it was read at. */
interface ParsedFile {
  mtimeMs: number;
  size: number;
  imports: string[];
  exports: number;
}

/** Root config whose changes can alter how specifiers resolve (path aliases). */
const CONFIG_FILE = "tsconfig.json";

/** Max concurrent file-system operations per batch. */
const IO_CHUNK = 64;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

async function statSignature(abs: string): Promise<Signature | null> {
  try {
    const s = await fs.stat(abs);
    return { mtimeMs: s.mtimeMs, size: s.size, key: `${s.mtimeMs}:${s.size}` };
  } catch {
    return null;
  }
}

/** Run `fn` over `items` in batches of `size`, awaiting each batch. */
async function inChunks<T>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export class DepGraph {
  /** forward: file -> set of in-repo files it imports. */
  private readonly forward = new Map<string, Set<string>>();
  /** reverse: file -> set of in-repo files that import it. */
  private readonly reverse = new Map<string, Set<string>>();
  /**
   * Parse cache: what was extracted from each code file the last time it was
   * read, plus the stat signature it was read at. Edges are always derivable
   * from this cache + the resolver, which is what makes updates incremental.
   */
  private readonly parsed = new Map<string, ParsedFile>();
  /** Every file (code or not) the resolver last saw; membership drives re-resolution. */
  private known: ReadonlySet<string> = new Set();
  private resolver: Resolver | null = null;
  /** Stat signature of the root tsconfig.json, or null when absent. */
  private configSig: string | null = null;

  private constructor(private readonly root: string) {}

  /**
   * Build the graph for `root`. Scans the repo (optionally reusing a provided
   * file list), parses each supported file and resolves its imports to edges.
   */
  static async build(root: string, files?: string[]): Promise<DepGraph> {
    const graph = DepGraph.empty(root);
    await graph.sync(files ?? (await scan(root)));
    return graph;
  }

  /** A graph with no nodes yet; call `sync` to populate it. */
  static empty(root: string): DepGraph {
    return new DepGraph(root);
  }

  /**
   * Bring the graph up to date with `files`, the CURRENT full file list of the
   * repo (as returned by `scan`). Cost is proportional to what changed:
   *
   *  - code files are `stat`ed (never read) to detect edits via mtime + size;
   *  - only new or edited files are read and parsed, and only their edges are
   *    replaced;
   *  - when files were added or removed (or tsconfig.json changed) an import
   *    that used to be unresolvable may now resolve, or the reverse, so every
   *    file's imports are re-resolved — but from the parse cache, without
   *    reading or parsing anything again.
   *
   * All I/O happens before the graph is touched and the update itself is
   * synchronous, so concurrent readers never observe a half-updated graph.
   * Files listed but missing on disk are ignored.
   */
  async sync(files: readonly string[]): Promise<SyncReport> {
    // ---- Phase 1: I/O only. Nothing on `this` is mutated here. ----
    const listed = [...new Set(files.map(toPosix))];
    const codeFiles = listed.filter((f) => parserFor(f) !== null);

    const stats = new Map<string, Signature>();
    await inChunks(codeFiles, IO_CHUNK, async (file) => {
      const sig = await statSignature(path.join(this.root, file));
      if (sig) stats.set(file, sig);
    });

    const changed = codeFiles.filter((f) => {
      const sig = stats.get(f);
      if (!sig) return false;
      const prev = this.parsed.get(f);
      return !prev || prev.mtimeMs !== sig.mtimeMs || prev.size !== sig.size;
    });

    const fresh = new Map<string, ParsedFile>();
    await inChunks(changed, IO_CHUNK, async (file) => {
      let content: string;
      try {
        content = await fs.readFile(path.join(this.root, file), "utf8");
      } catch {
        stats.delete(file); // vanished between stat and read
        return;
      }
      const { imports, exports } = parseSource(file, content);
      fresh.set(file, { ...stats.get(file)!, imports, exports });
    });

    // Non-code files are trusted from the list; code files must exist on disk.
    const present = new Set(listed.filter((f) => parserFor(f) === null || stats.has(f)));
    const configSig = present.has(CONFIG_FILE)
      ? ((await statSignature(path.join(this.root, CONFIG_FILE)))?.key ?? null)
      : null;

    const relink =
      this.resolver === null ||
      configSig !== this.configSig ||
      !sameMembers(present, this.known);
    const resolver = relink ? await Resolver.create(this.root, present) : this.resolver!;

    // ---- Phase 2: synchronous, atomic update of the graph. ----
    const removed: string[] = [];
    for (const file of [...this.parsed.keys()]) {
      if (stats.has(file)) continue;
      removed.push(file);
      this.parsed.delete(file);
      this.forward.delete(file);
      this.reverse.delete(file);
    }
    for (const [file, entry] of fresh) this.parsed.set(file, entry);
    for (const file of stats.keys()) {
      if (!this.forward.has(file)) {
        this.forward.set(file, new Set());
        this.reverse.set(file, new Set());
      }
    }
    this.resolver = resolver;
    this.known = present;
    this.configSig = configSig;

    if (relink) {
      // Removed files may still be referenced by surviving edge sets: rebuild all.
      for (const set of this.forward.values()) set.clear();
      for (const set of this.reverse.values()) set.clear();
      for (const file of this.forward.keys()) this.link(file);
    } else {
      for (const file of fresh.keys()) {
        this.unlink(file);
        this.link(file);
      }
    }

    return {
      reparsed: [...fresh.keys()].sort(),
      removed: removed.sort(),
      relinked: relink,
    };
  }

  /** Drop the outgoing edges of `file` (and the matching reverse entries). */
  private unlink(file: string): void {
    const out = this.forward.get(file);
    if (!out) return;
    for (const target of out) this.reverse.get(target)?.delete(file);
    out.clear();
  }

  /** Resolve the cached imports of `file` into edges. All nodes must already exist. */
  private link(file: string): void {
    const entry = this.parsed.get(file);
    if (!entry || !this.resolver) return;
    for (const spec of entry.imports) {
      const target = this.resolver.resolve(file, spec);
      if (target === null) continue; // external or unresolved
      if (!this.forward.has(target)) continue; // guard: non-code target
      this.forward.get(file)!.add(target);
      this.reverse.get(target)!.add(file);
    }
  }

  /** All node paths (repo-relative POSIX), unsorted. */
  nodes(): string[] {
    return [...this.forward.keys()];
  }

  /** True when the path is a known node. */
  has(file: string): boolean {
    return this.forward.has(file);
  }

  /** Direct in-repo dependencies (files this file imports), sorted. */
  dependencies(file: string): string[] {
    return [...(this.forward.get(file) ?? [])].sort();
  }

  /** Direct in-repo dependents (files that import this file), sorted. */
  dependents(file: string): string[] {
    return [...(this.reverse.get(file) ?? [])].sort();
  }

  /** Per-node metrics, or null when the path is not a node. */
  metrics(file: string): NodeMetrics | null {
    if (!this.forward.has(file)) return null;
    const entry = this.parsed.get(file);
    return {
      fanIn: this.reverse.get(file)!.size,
      fanOut: this.forward.get(file)!.size,
      imports: entry?.imports.length ?? 0,
      exports: entry?.exports ?? 0,
    };
  }

  /**
   * Blast radius: all nodes reachable from `file` following edges in the given
   * direction, with their shortest hop distance. BFS so distances are minimal;
   * a visited set makes it cycle-safe. `depth` (>=1) caps the number of hops;
   * omitting it returns the full transitive closure. The start node itself is
   * never included. Returns [] for an unknown node.
   */
  impact(file: string, options: ImpactOptions): ImpactedNode[] {
    if (!this.forward.has(file)) return [];
    const edges = options.direction === "dependents" ? this.reverse : this.forward;
    const maxDepth = options.depth ?? Infinity;

    const visited = new Set<string>([file]);
    const out: ImpactedNode[] = [];
    let frontier: string[] = [file];
    let distance = 0;

    while (frontier.length > 0 && distance < maxDepth) {
      distance += 1;
      const next: string[] = [];
      for (const node of frontier) {
        for (const neighbor of edges.get(node) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          out.push({ path: neighbor, distance });
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return out;
  }

  /**
   * Dependency cycles in the forward graph, each as a list of node paths.
   * Uses Tarjan's strongly-connected-components algorithm; an SCC with more
   * than one node (or a single node importing itself) is a cycle. Trivial
   * single-node SCCs with no self-edge are not reported.
   */
  cycles(): string[][] {
    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const result: string[][] = [];

    const strongConnect = (v: string): void => {
      indices.set(v, index);
      lowlink.set(v, index);
      index += 1;
      stack.push(v);
      onStack.add(v);

      for (const w of this.forward.get(v) ?? []) {
        if (!indices.has(w)) {
          strongConnect(w);
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
        }
      }

      if (lowlink.get(v) === indices.get(v)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        const selfLoop = component.length === 1 && (this.forward.get(v)?.has(v) ?? false);
        if (component.length > 1 || selfLoop) {
          result.push(component.sort());
        }
      }
    };

    for (const v of this.forward.keys()) {
      if (!indices.has(v)) strongConnect(v);
    }
    return result;
  }
}
