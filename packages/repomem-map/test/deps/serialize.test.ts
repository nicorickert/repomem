import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DepGraph } from "../../src/deps/graph.js";
import { MapIndex } from "../../src/mapindex.js";
import { serializeGraph } from "../../src/deps/serialize.js";
import { hashContent, writeSummary, type SummaryRecord } from "../../src/summary.js";

let root: string;

async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
}

function rec(content: string, summary: string): SummaryRecord {
  return {
    hash: hashContent(content),
    summary,
    search_terms: [],
    model: "agent",
    generated_at: new Date().toISOString(),
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-serialize-"));
  // src/api/a -> src/api/b -> src/core/c ; plus a cycle x <-> y under src/core
  await wf("src/api/a.ts", `import "./b";\nexport const a = 1;\n`);
  await wf("src/api/b.ts", `import "../core/c";\nexport const b = 1;\n`);
  await wf("src/core/c.ts", `export const c = 1;\n`);
  await wf("src/core/x.ts", `import "./y";\nexport const x = 1;\n`);
  await wf("src/core/y.ts", `import "./x";\nexport const y = 1;\n`);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("serializeGraph", () => {
  it("produces nodes and edges for the whole graph", async () => {
    const g = await DepGraph.build(root);
    const json = serializeGraph(g);
    const ids = json.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([
      "src/api/a.ts",
      "src/api/b.ts",
      "src/core/c.ts",
      "src/core/x.ts",
      "src/core/y.ts",
    ]);
    expect(json.edges).toContainEqual({ source: "src/api/a.ts", target: "src/api/b.ts" });
    expect(json.edges).toContainEqual({ source: "src/api/b.ts", target: "src/core/c.ts" });
  });

  it("includes per-node metrics", async () => {
    const g = await DepGraph.build(root);
    const json = serializeGraph(g);
    const b = json.nodes.find((n) => n.id === "src/api/b.ts")!;
    expect(b.fanIn).toBe(1);
    expect(b.fanOut).toBe(1);
    expect(b.exports).toBe(1);
  });

  it("marks nodes that participate in a cycle", async () => {
    const g = await DepGraph.build(root);
    const json = serializeGraph(g);
    const x = json.nodes.find((n) => n.id === "src/core/x.ts")!;
    const y = json.nodes.find((n) => n.id === "src/core/y.ts")!;
    const c = json.nodes.find((n) => n.id === "src/core/c.ts")!;
    expect(x.inCycle).toBe(true);
    expect(y.inCycle).toBe(true);
    expect(c.inCycle).toBe(false);
    expect(json.cycles.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by scope (path prefix)", async () => {
    const g = await DepGraph.build(root);
    const json = serializeGraph(g, { scope: "src/api" });
    const ids = json.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["src/api/a.ts", "src/api/b.ts"]);
    // edges to out-of-scope nodes are dropped
    for (const e of json.edges) {
      expect(e.source.startsWith("src/api")).toBe(true);
      expect(e.target.startsWith("src/api")).toBe(true);
    }
  });

  it("limits to a focus node's neighborhood within depth", async () => {
    const g = await DepGraph.build(root);
    const json = serializeGraph(g, { focus: "src/api/a.ts", depth: 1 });
    const ids = json.nodes.map((n) => n.id).sort();
    // a itself + its depth-1 neighbors in both directions (just b)
    expect(ids).toEqual(["src/api/a.ts", "src/api/b.ts"]);
  });

  it("attaches summaries when a MapIndex is provided, and degrades without one", async () => {
    await writeSummary(root, "src/core/c.ts", rec("export const c = 1;\n", "core helper c"));
    const g = await DepGraph.build(root);
    const index = await MapIndex.load(root);

    const withIdx = serializeGraph(g, {}, index);
    const c = withIdx.nodes.find((n) => n.id === "src/core/c.ts")!;
    expect(c.summary).toBe("core helper c");

    const noIdx = serializeGraph(g);
    const c2 = noIdx.nodes.find((n) => n.id === "src/core/c.ts")!;
    expect(c2.summary).toBeUndefined();
  });
});
