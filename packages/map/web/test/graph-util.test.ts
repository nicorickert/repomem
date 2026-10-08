import { describe, it, expect } from "vitest";
import {
  toGraphData,
  neighborhood,
  nodeRadius,
  degreeOf,
  groupKey,
  hubThreshold,
  type GraphModel,
} from "../src/graph-util.js";

const model: GraphModel = {
  nodes: [
    { id: "a.ts", path: "a.ts", fanIn: 0, fanOut: 1, imports: 1, exports: 1, inCycle: false },
    { id: "b.ts", path: "b.ts", fanIn: 1, fanOut: 1, imports: 1, exports: 2, inCycle: true },
    { id: "c.ts", path: "c.ts", fanIn: 1, fanOut: 0, imports: 0, exports: 3, inCycle: true },
  ],
  edges: [
    { source: "a.ts", target: "b.ts" },
    { source: "b.ts", target: "c.ts" },
  ],
  cycles: [["b.ts", "c.ts"]],
};

describe("toGraphData", () => {
  it("maps the model to D3 nodes and links by reference-friendly ids", () => {
    const data = toGraphData(model);
    expect(data.nodes).toHaveLength(3);
    expect(data.links).toEqual([
      { source: "a.ts", target: "b.ts" },
      { source: "b.ts", target: "c.ts" },
    ]);
  });
});

describe("degreeOf", () => {
  it("is fan-in plus fan-out", () => {
    expect(degreeOf(model.nodes[1]!)).toBe(2);
    expect(degreeOf(model.nodes[0]!)).toBe(1);
  });
});

describe("neighborhood", () => {
  it("returns the node plus its direct dependents and dependencies", () => {
    const near = neighborhood(model, "b.ts");
    expect([...near].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("for a leaf returns itself and its single neighbor", () => {
    const near = neighborhood(model, "a.ts");
    expect([...near].sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("is empty-ish (just the node) for an unknown id", () => {
    const near = neighborhood(model, "zzz.ts");
    expect([...near]).toEqual(["zzz.ts"]);
  });
});

describe("nodeRadius", () => {
  it("grows monotonically with the chosen metric", () => {
    const byDegree = (n: GraphModel["nodes"][number]) => nodeRadius(n, "degree");
    // c has degree 1, b has degree 2 => b larger
    expect(byDegree(model.nodes[1]!)).toBeGreaterThan(byDegree(model.nodes[2]!));
  });

  it("supports the imports+exports metric", () => {
    const bySurface = (n: GraphModel["nodes"][number]) => nodeRadius(n, "surface");
    // c surface = 0+3 = 3, a surface = 1+1 = 2 => c larger
    expect(bySurface(model.nodes[2]!)).toBeGreaterThan(bySurface(model.nodes[0]!));
  });

  it("never returns a radius below the minimum", () => {
    const tiny = { id: "z", path: "z", fanIn: 0, fanOut: 0, imports: 0, exports: 0, inCycle: false };
    expect(nodeRadius(tiny, "degree")).toBeGreaterThanOrEqual(4);
  });
});

describe("groupKey", () => {
  it("returns the directory up to the given level", () => {
    expect(groupKey("src/api/db/client.ts", 1)).toBe("src");
    expect(groupKey("src/api/db/client.ts", 2)).toBe("src/api");
    expect(groupKey("src/api/db/client.ts", 3)).toBe("src/api/db");
  });

  it("caps the level at the file's own directory", () => {
    // only two dir segments available; level 5 cannot go deeper
    expect(groupKey("src/api/client.ts", 5)).toBe("src/api");
  });

  it("groups a top-level file under a sentinel root", () => {
    expect(groupKey("index.ts", 1)).toBe(".");
    expect(groupKey("index.ts", 2)).toBe(".");
  });

  it("treats level < 1 as level 1", () => {
    expect(groupKey("src/api/client.ts", 0)).toBe("src");
  });
});

describe("hubThreshold", () => {
  it("returns a degree cutoff at the given percentile", () => {
    const nodes = [1, 2, 3, 4, 10].map((d, i) => ({
      id: `n${i}`,
      path: `n${i}`,
      fanIn: d,
      fanOut: 0,
      imports: 0,
      exports: 0,
      inCycle: false,
    }));
    // nearest-rank p90 of degrees [1,2,3,4,10] lands on 4, so n3 and n4 qualify
    const t = hubThreshold(nodes, 0.9);
    expect(t).toBe(4);
    const hubs = nodes.filter((n) => degreeOf(n) >= t);
    expect(hubs.map((h) => h.id).sort()).toEqual(["n3", "n4"]);
  });

  it("is safe for an empty node list", () => {
    expect(hubThreshold([], 0.9)).toBe(0);
  });
});
