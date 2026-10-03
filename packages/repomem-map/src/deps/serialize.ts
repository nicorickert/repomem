/**
 * serialize.ts — turn a DepGraph into a plain JSON model for the web viewer.
 *
 * The model is intentionally render-agnostic (nodes + edges + cycles) so the
 * frontend can lay it out with D3-force. Filters let the caller narrow a large
 * graph to something legible: a `scope` path prefix, or a `focus` node with a
 * `depth`-bounded neighborhood (both dependents and dependencies).
 *
 * Summaries are optional: when a MapIndex is passed, each node is annotated
 * with its summary if one exists; without it, nodes simply have no summary.
 * The graph itself never depends on summaries.
 */

import type { DepGraph } from "./graph.js";
import type { MapIndex } from "../mapindex.js";

/** A node in the serialized graph. */
export interface GraphNode {
  id: string;
  path: string;
  /** Optional summary text, present only when a MapIndex supplies one. */
  summary?: string;
  fanIn: number;
  fanOut: number;
  imports: number;
  exports: number;
  /** True when the node participates in a dependency cycle. */
  inCycle: boolean;
}

/** A directed edge: `source` imports `target`. */
export interface GraphEdge {
  source: string;
  target: string;
}

/** The full serialized graph model. */
export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Dependency cycles, each a list of node ids. */
  cycles: string[][];
}

/** Filters that narrow the serialized graph. */
export interface SerializeOptions {
  /** Keep only nodes whose path is under this prefix (e.g. "src/api"). */
  scope?: string;
  /** Center on this node; keep only its depth-bounded neighborhood. */
  focus?: string;
  /** Max hops from `focus` (both directions). Omit for the full closure. */
  depth?: number;
}

/** True when `path` is within `scope` (prefix match on path segments). */
function inScope(path: string, scope: string): boolean {
  const s = scope.replace(/\/+$/, "");
  return path === s || path.startsWith(s + "/");
}

/**
 * Serialize `graph` to a GraphModel, applying optional scope/focus filters and
 * attaching summaries from `index` when available.
 */
export function serializeGraph(
  graph: DepGraph,
  options: SerializeOptions = {},
  index?: MapIndex,
): GraphModel {
  const cycles = graph.cycles();
  const inCycle = new Set(cycles.flat());

  // Determine the set of visible node ids after filtering.
  let visible = new Set(graph.nodes());

  if (options.focus && graph.has(options.focus)) {
    const near = new Set<string>([options.focus]);
    for (const n of graph.impact(options.focus, { direction: "dependents", depth: options.depth })) {
      near.add(n.path);
    }
    for (const n of graph.impact(options.focus, { direction: "dependencies", depth: options.depth })) {
      near.add(n.path);
    }
    visible = new Set([...visible].filter((id) => near.has(id)));
  }

  if (options.scope) {
    visible = new Set([...visible].filter((id) => inScope(id, options.scope!)));
  }

  const nodes: GraphNode[] = [...visible].map((id) => {
    const m = graph.metrics(id)!;
    const node: GraphNode = {
      id,
      path: id,
      fanIn: m.fanIn,
      fanOut: m.fanOut,
      imports: m.imports,
      exports: m.exports,
      inCycle: inCycle.has(id),
    };
    const summary = index?.get(id)?.summary;
    if (summary) node.summary = summary;
    return node;
  });

  const edges: GraphEdge[] = [];
  for (const source of visible) {
    for (const target of graph.dependencies(source)) {
      if (visible.has(target)) edges.push({ source, target });
    }
  }

  // Keep only cycles fully contained in the visible set.
  const visibleCycles = cycles.filter((c) => c.every((id) => visible.has(id)));

  return { nodes, edges, cycles: visibleCycles };
}
