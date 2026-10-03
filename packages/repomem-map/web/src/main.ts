/**
 * main.ts — the D3-force dependency graph viewer.
 *
 * Fetches the serialized graph from the map's `/graph` endpoint (honoring the
 * scope/focus/depth toolbar controls) and renders it as a force-directed
 * graph. Nodes are clustered by folder "section" (a path prefix at a chosen
 * depth) with a colored hull + label behind each section, so the structure is
 * legible at a glance. Interactivity: click a node to highlight its
 * neighborhood and show its summary; cycles are highlighted automatically;
 * node size reflects the selected metric; labels show only for hubs and the
 * current selection to avoid clutter. Pure data helpers live in graph-util.ts.
 */

import * as d3 from "d3";
import {
  toGraphData,
  neighborhood,
  nodeRadius,
  groupKey,
  hubThreshold,
  type GraphModel,
  type GraphModelNode,
  type SizeMetric,
} from "./graph-util.js";

type SimNode = GraphModelNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & { source: string | SimNode; target: string | SimNode };

const graphEl = document.getElementById("graph") as HTMLDivElement;
const sideEl = document.getElementById("side") as HTMLElement;

function qs<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Build the `/graph` query string from the toolbar inputs. */
function currentQuery(): string {
  const params = new URLSearchParams();
  const scope = qs<HTMLInputElement>("scope").value.trim();
  const focus = qs<HTMLInputElement>("focus").value.trim();
  const depth = qs<HTMLInputElement>("depth").value.trim();
  if (scope) params.set("scope", scope);
  if (focus) params.set("focus", focus);
  if (depth) params.set("depth", depth);
  const q = params.toString();
  return q ? `?${q}` : "";
}

function metric(): SizeMetric {
  return qs<HTMLSelectElement>("metric").value as SizeMetric;
}

function groupLevel(): number {
  return Number.parseInt(qs<HTMLInputElement>("group").value, 10) || 1;
}

async function loadAndRender(): Promise<void> {
  const res = await fetch(`/graph${currentQuery()}`);
  const model: GraphModel = await res.json();
  render(model);
}

function idOf(end: string | SimNode): string {
  return typeof end === "string" ? end : end.id;
}

function render(model: GraphModel): void {
  graphEl.innerHTML = "";
  const width = graphEl.clientWidth || 800;
  const height = graphEl.clientHeight || 600;

  const data = toGraphData(model);
  const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
  const links: SimLink[] = data.links.map((l) => ({ source: l.source, target: l.target }));
  const cycleNodes = new Set(model.cycles.flat());
  const level = groupLevel();
  const m = metric();

  // Section (folder) grouping.
  const sectionOf = new Map<string, string>();
  for (const n of nodes) sectionOf.set(n.id, groupKey(n.path, level));
  const sections = [...new Set(sectionOf.values())].sort();
  const color = d3.scaleOrdinal<string, string>().domain(sections).range(d3.schemeTableau10);

  // Only hubs (and the selection) get labels, to reduce clutter.
  const hubCut = hubThreshold(data.nodes, 0.85);

  const svg = d3.select(graphEl).append("svg").attr("viewBox", `0 0 ${width} ${height}`);

  // Arrowhead markers: the arrow points at the dependency (source -> target,
  // i.e. source imports target). A separate red marker is used for cycle edges.
  const defs = svg.append("defs");
  const makeMarker = (id: string, cls: string): void => {
    defs
      .append("marker")
      .attr("id", id)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 10)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("class", cls);
  };
  makeMarker("arrow", "arrowhead");
  makeMarker("arrow-cycle", "arrowhead cycle");

  const zoomLayer = svg.append("g");
  svg.call(
    d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 4]).on("zoom", (ev) => {
      zoomLayer.attr("transform", ev.transform.toString());
    }),
  );

  // Layer order: hulls (behind) -> hull labels -> links -> nodes -> node labels.
  const hullLayer = zoomLayer.append("g").attr("class", "hulls");
  const hullLabelLayer = zoomLayer.append("g").attr("class", "hull-labels");

  const link = zoomLayer
    .append("g")
    .selectAll<SVGLineElement, SimLink>("line")
    .data(links)
    .join("line")
    .attr("class", (d) =>
      cycleNodes.has(idOf(d.source)) && cycleNodes.has(idOf(d.target)) ? "link cycle" : "link",
    )
    .attr("marker-end", (d) =>
      cycleNodes.has(idOf(d.source)) && cycleNodes.has(idOf(d.target))
        ? "url(#arrow-cycle)"
        : "url(#arrow)",
    );

  const node = zoomLayer
    .append("g")
    .selectAll<SVGCircleElement, SimNode>("circle")
    .data(nodes)
    .join("circle")
    .attr("class", (d) => (d.inCycle ? "node cycle" : "node"))
    .attr("r", (d) => nodeRadius(d, m))
    .attr("fill", (d) => color(sectionOf.get(d.id)!));
  node.append("title").text((d) => d.path);

  const label = zoomLayer
    .append("g")
    .selectAll<SVGTextElement, SimNode>("text")
    .data(nodes)
    .join("text")
    .attr("class", "label")
    .style("display", (d) => (d.fanIn + d.fanOut >= hubCut && hubCut > 0 ? null : "none"))
    .text((d) => d.path.split("/").pop() ?? d.path);

  // More breathing room: stronger repulsion, longer links, section clustering.
  const sectionCenters = new Map<string, { x: number; y: number }>();
  sections.forEach((s, i) => {
    const angle = (i / Math.max(1, sections.length)) * 2 * Math.PI;
    sectionCenters.set(s, {
      x: width / 2 + Math.cos(angle) * width * 0.28,
      y: height / 2 + Math.sin(angle) * height * 0.28,
    });
  });

  const sim = d3
    .forceSimulation<SimNode>(nodes)
    .force(
      "link",
      d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(90).strength(0.4),
    )
    .force("charge", d3.forceManyBody().strength(-420))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide<SimNode>().radius((d) => nodeRadius(d, m) + 8))
    // Pull each node toward its section's center so folders cluster together.
    .force(
      "x",
      d3.forceX<SimNode>((d) => sectionCenters.get(sectionOf.get(d.id)!)?.x ?? width / 2).strength(0.12),
    )
    .force(
      "y",
      d3.forceY<SimNode>((d) => sectionCenters.get(sectionOf.get(d.id)!)?.y ?? height / 2).strength(0.12),
    );

  const line = d3.line().curve(d3.curveCatmullRomClosed);

  function drawHulls(): void {
    const groups = d3.group(nodes, (d) => sectionOf.get(d.id)!);
    const hullData: Array<{ key: string; points: [number, number][] }> = [];
    for (const [key, members] of groups) {
      const pts = members.map((d) => [d.x ?? 0, d.y ?? 0] as [number, number]);
      if (pts.length < 2) {
        // Pad a single point so it still gets a small bubble.
        const [p] = pts;
        if (p) pts.push([p[0] + 1, p[1] + 1]);
      }
      const hull = d3.polygonHull(pts.length >= 3 ? pts : [...pts, [pts[0]![0] + 1, pts[0]![1] + 1]]);
      hullData.push({ key, points: hull ?? pts });
    }

    const hull = hullLayer
      .selectAll<SVGPathElement, (typeof hullData)[number]>("path")
      .data(hullData, (d) => d.key)
      .join("path")
      .attr("fill", (d) => color(d.key))
      .attr("stroke", (d) => color(d.key))
      .attr("class", "hull");
    hull.attr("d", (d) => {
      // Expand the hull a little so it wraps around the nodes.
      const centroid = d3.polygonCentroid(d.points as [number, number][]);
      const padded = d.points.map(([x, y]) => {
        const dx = x - centroid[0];
        const dy = y - centroid[1];
        const len = Math.hypot(dx, dy) || 1;
        return [x + (dx / len) * 18, y + (dy / len) * 18] as [number, number];
      });
      return line(padded);
    });

    hullLabelLayer
      .selectAll<SVGTextElement, (typeof hullData)[number]>("text")
      .data(hullData, (d) => d.key)
      .join("text")
      .attr("class", "hull-label")
      .text((d) => d.key)
      .attr("x", (d) => d3.polygonCentroid(d.points as [number, number][])[0])
      .attr("y", (d) => Math.min(...d.points.map((p) => p[1])) - 6);
  }

  sim.on("tick", () => {
    drawHulls();
    link
      .attr("x1", (d) => (d.source as SimNode).x ?? 0)
      .attr("y1", (d) => (d.source as SimNode).y ?? 0)
      .attr("x2", (d) => endpoint(d).x)
      .attr("y2", (d) => endpoint(d).y);
    node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
    label.attr("x", (d) => (d.x ?? 0) + 7).attr("y", (d) => (d.y ?? 0) + 3);
  });

  // Stop the line at the target node's edge so the arrowhead is visible.
  function endpoint(d: SimLink): { x: number; y: number } {
    const s = d.source as SimNode;
    const t = d.target as SimNode;
    const sx = s.x ?? 0;
    const sy = s.y ?? 0;
    const tx = t.x ?? 0;
    const ty = t.y ?? 0;
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const pad = nodeRadius(t, m) + 6; // node radius + a little gap for the arrow
    return { x: tx - (dx / dist) * pad, y: ty - (dy / dist) * pad };
  }

  node.call(
    d3
      .drag<SVGCircleElement, SimNode>()
      .on("start", (ev, d) => {
        if (!ev.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (ev, d) => {
        d.fx = ev.x;
        d.fy = ev.y;
      })
      .on("end", (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }),
  );

  function select(id: string): void {
    const near = neighborhood(model, id);
    node.classed("dim", (d) => !near.has(d.id));
    link.classed("dim", (d) => !(near.has(idOf(d.source)) && near.has(idOf(d.target))));
    // Reveal labels for the selected neighborhood too.
    label.style("display", (d) =>
      near.has(d.id) || (d.fanIn + d.fanOut >= hubCut && hubCut > 0) ? null : "none",
    );
    showDetails(model, id);
  }

  function deselect(): void {
    node.classed("dim", false);
    link.classed("dim", false);
    label.style("display", (d) => (d.fanIn + d.fanOut >= hubCut && hubCut > 0 ? null : "none"));
    sideEl.innerHTML = "<em>Click a node to inspect it.</em>";
  }

  // Clicking empty canvas clears the selection. Node clicks stop propagation
  // (below) so they don't bubble up to this handler.
  svg.on("click", () => deselect());
  node.on("click", (ev, d) => {
    ev.stopPropagation();
    select(d.id);
  });
}

function showDetails(model: GraphModel, id: string): void {
  const n = model.nodes.find((x) => x.id === id);
  if (!n) return;
  const deps = model.edges.filter((e) => e.source === id).map((e) => e.target);
  const dependents = model.edges.filter((e) => e.target === id).map((e) => e.source);
  const li = (p: string): string => `<li data-id="${p}">${p}</li>`;
  sideEl.innerHTML = `
    <h2>${n.path}</h2>
    ${n.summary ? `<div class="summary">${n.summary}</div>` : `<div class="summary"><em>no summary</em></div>`}
    <div class="legend">fan-in ${n.fanIn} · fan-out ${n.fanOut} · imports ${n.imports} · exports ${n.exports}${n.inCycle ? ` · <span class="cycle">in cycle</span>` : ""}</div>
    <div class="lists">
      <strong>Dependencies (${deps.length})</strong>
      <ul>${deps.map(li).join("") || "<li><em>none</em></li>"}</ul>
      <strong>Dependents (${dependents.length})</strong>
      <ul>${dependents.map(li).join("") || "<li><em>none</em></li>"}</ul>
    </div>`;
  for (const el of Array.from(sideEl.querySelectorAll("li[data-id]"))) {
    el.addEventListener("click", () => {
      const target = (el as HTMLElement).dataset.id;
      if (target) qs<HTMLInputElement>("focus").value = target;
    });
  }
}

qs<HTMLButtonElement>("apply").addEventListener("click", () => void loadAndRender());
qs<HTMLSelectElement>("metric").addEventListener("change", () => void loadAndRender());
qs<HTMLInputElement>("group").addEventListener("change", () => void loadAndRender());

void loadAndRender();
