/**
 * graph-util.ts — pure helpers for the dependency graph viewer.
 *
 * These are UI-framework-agnostic and side-effect free so they can be unit
 * tested without a browser or D3. They mirror the GraphModel served by the
 * map's HTTP `/graph` endpoint and derive the values the D3-force view needs:
 * link data, a focus node's neighborhood, node degree and node radius.
 */

/** A node as served by `/graph`. */
export interface GraphModelNode {
  id: string;
  path: string;
  summary?: string;
  fanIn: number;
  fanOut: number;
  imports: number;
  exports: number;
  inCycle: boolean;
}

/** The graph model served by `/graph`. */
export interface GraphModel {
  nodes: GraphModelNode[];
  edges: Array<{ source: string; target: string }>;
  cycles: string[][];
}

/** D3-friendly shape: nodes plus links referencing node ids. */
export interface GraphData {
  nodes: GraphModelNode[];
  links: Array<{ source: string; target: string }>;
}

/** Which metric drives node size. */
export type SizeMetric = "degree" | "surface";

/** Minimum node radius so tiny nodes stay clickable. */
export const MIN_RADIUS = 4;

/** Map the served model to D3 nodes + links. */
export function toGraphData(model: GraphModel): GraphData {
  return {
    nodes: model.nodes,
    links: model.edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

/** Total degree (fan-in + fan-out) of a node. */
export function degreeOf(node: GraphModelNode): number {
  return node.fanIn + node.fanOut;
}

/**
 * The focus node plus its direct dependents and dependencies (one hop in
 * either direction). Always contains the focus id itself.
 */
export function neighborhood(model: GraphModel, id: string): Set<string> {
  const near = new Set<string>([id]);
  for (const e of model.edges) {
    if (e.source === id) near.add(e.target);
    if (e.target === id) near.add(e.source);
  }
  return near;
}

/**
 * Node radius for the chosen metric. Uses a sqrt scale so area, not radius,
 * grows with the metric (perceptually fairer), clamped to a minimum.
 */
export function nodeRadius(node: GraphModelNode, metric: SizeMetric): number {
  const value = metric === "degree" ? degreeOf(node) : node.imports + node.exports;
  return MIN_RADIUS + Math.sqrt(Math.max(0, value)) * 3;
}
