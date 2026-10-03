/**
 * graph.ts — the in-memory file->file dependency graph.
 *
 * Built at startup from the repository (never committed), mirroring how
 * MapIndex loads summaries. Nodes are every scannable TS/JS file, whether or
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

export class DepGraph {
  /** forward: file -> set of in-repo files it imports. */
  private readonly forward = new Map<string, Set<string>>();
  /** reverse: file -> set of in-repo files that import it. */
  private readonly reverse = new Map<string, Set<string>>();
  /** raw import specifier count per file. */
  private readonly rawImports = new Map<string, number>();
  /** export symbol count per file. */
  private readonly exportCounts = new Map<string, number>();

  private constructor() {}

  /**
   * Build the graph for `root`. Scans the repo (optionally reusing a provided
   * file list), parses each supported file and resolves its imports to edges.
   */
  static async build(root: string, files?: string[]): Promise<DepGraph> {
    const all = files ?? (await scan(root));
    const codeFiles = all.filter((f) => parserFor(f) !== null);
    const resolver = await Resolver.create(root, all);
    const graph = new DepGraph();

    // Register every code file as a node first (so isolated files appear too).
    for (const file of codeFiles) {
      graph.forward.set(file, new Set());
      graph.reverse.set(file, new Set());
      graph.rawImports.set(file, 0);
      graph.exportCounts.set(file, 0);
    }

    for (const file of codeFiles) {
      const content = await fs.readFile(path.join(root, file), "utf8");
      const { imports, exports } = parseSource(file, content);
      graph.rawImports.set(file, imports.length);
      graph.exportCounts.set(file, exports);
      for (const spec of imports) {
        const target = resolver.resolve(file, spec);
        if (target === null) continue; // external or unresolved
        if (!graph.forward.has(target)) continue; // guard: non-code target
        graph.forward.get(file)!.add(target);
        graph.reverse.get(target)!.add(file);
      }
    }

    return graph;
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
    return {
      fanIn: this.reverse.get(file)!.size,
      fanOut: this.forward.get(file)!.size,
      imports: this.rawImports.get(file) ?? 0,
      exports: this.exportCounts.get(file) ?? 0,
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
