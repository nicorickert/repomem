/**
 * main.ts — the D3-force dependency graph viewer.
 *
 * Fetches the serialized graph from the map's `/graph` endpoint (honoring the
 * scope/focus/depth toolbar controls), renders it as a force-directed graph,
 * and wires interactivity: click a node to highlight its neighborhood and show
 * its summary; cycles are highlighted automatically; node size reflects the
 * selected metric (graph degree or imports+exports). Pure data helpers live in
 * graph-util.ts and are unit tested separately.
 */

import * as d3 from "d3";
import {
  toGraphData,
  neighborhood,
  nodeRadius,
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
  const cycleEdges = new Set(model.cycles.flat());

  const svg = d3
    .select(graphEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const zoomLayer = svg.append("g");
  svg.call(
    d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 4]).on("zoom", (ev) => {
      zoomLayer.attr("transform", ev.transform.toString());
    }),
  );

  const color = d3.scaleOrdinal(d3.schemeTableau10);
  const topDir = (p: string): string => p.split("/")[0] ?? p;

  const link = zoomLayer
    .append("g")
    .selectAll<SVGLineElement, SimLink>("line")
    .data(links)
    .join("line")
    .attr("class", (d) =>
      cycleEdges.has(idOf(d.source)) && cycleEdges.has(idOf(d.target)) ? "link cycle" : "link",
    );

  const m = metric();
  const node = zoomLayer
    .append("g")
    .selectAll<SVGCircleElement, SimNode>("circle")
    .data(nodes)
    .join("circle")
    .attr("class", (d) => (d.inCycle ? "node cycle" : "node"))
    .attr("r", (d) => nodeRadius(d, m))
    .attr("fill", (d) => color(topDir(d.path)))
    .on("click", (_ev, d) => select(d.id));

  node.append("title").text((d) => d.path);

  const label = zoomLayer
    .append("g")
    .selectAll<SVGTextElement, SimNode>("text")
    .data(nodes)
    .join("text")
    .attr("class", "label")
    .text((d) => d.path.split("/").pop() ?? d.path);

  const sim = d3
    .forceSimulation<SimNode>(nodes)
    .force(
      "link",
      d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(60),
    )
    .force("charge", d3.forceManyBody().strength(-180))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide<SimNode>().radius((d) => nodeRadius(d, m) + 2));

  sim.on("tick", () => {
    link
      .attr("x1", (d) => (d.source as SimNode).x ?? 0)
      .attr("y1", (d) => (d.source as SimNode).y ?? 0)
      .attr("x2", (d) => (d.target as SimNode).x ?? 0)
      .attr("y2", (d) => (d.target as SimNode).y ?? 0);
    node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
    label.attr("x", (d) => (d.x ?? 0) + 6).attr("y", (d) => (d.y ?? 0) + 3);
  });

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
    showDetails(model, id);
  }
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
      if (target) {
        qs<HTMLInputElement>("focus").value = target;
      }
    });
  }
}

qs<HTMLButtonElement>("apply").addEventListener("click", () => void loadAndRender());
qs<HTMLSelectElement>("metric").addEventListener("change", () => void loadAndRender());

void loadAndRender();
