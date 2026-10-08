import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DepGraph } from "../../src/deps/graph.js";

let root: string;

async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
}

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("DepGraph.impact (blast radius)", () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-impact-"));
    // chain a -> b -> c -> d  (a imports b, b imports c, c imports d)
    await wf("a.ts", `import "./b";\nexport const a = 1;\n`);
    await wf("b.ts", `import "./c";\nexport const b = 1;\n`);
    await wf("c.ts", `import "./d";\nexport const c = 1;\n`);
    await wf("d.ts", `export const d = 1;\n`);
  });

  it("transitive dependents of d are a, b, c (who breaks if d changes)", async () => {
    const g = await DepGraph.build(root);
    const impacted = g.impact("d.ts", { direction: "dependents" });
    const paths = impacted.map((i) => i.path).sort();
    expect(paths).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("records the hop distance of each impacted node", async () => {
    const g = await DepGraph.build(root);
    const impacted = g.impact("d.ts", { direction: "dependents" });
    const byPath = new Map(impacted.map((i) => [i.path, i.distance]));
    expect(byPath.get("c.ts")).toBe(1);
    expect(byPath.get("b.ts")).toBe(2);
    expect(byPath.get("a.ts")).toBe(3);
  });

  it("depth:1 limits dependents to the direct ones", async () => {
    const g = await DepGraph.build(root);
    const impacted = g.impact("d.ts", { direction: "dependents", depth: 1 });
    expect(impacted.map((i) => i.path)).toEqual(["c.ts"]);
  });

  it("transitive dependencies of a are b, c, d (what a relies on)", async () => {
    const g = await DepGraph.build(root);
    const impacted = g.impact("a.ts", { direction: "dependencies" });
    expect(impacted.map((i) => i.path).sort()).toEqual(["b.ts", "c.ts", "d.ts"]);
  });

  it("returns empty for an unknown node", async () => {
    const g = await DepGraph.build(root);
    expect(g.impact("missing.ts", { direction: "dependents" })).toEqual([]);
  });
});

describe("DepGraph.cycles", () => {
  it("terminates and reports a 2-node cycle a <-> b", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-cycle-"));
    await wf("a.ts", `import "./b";\nexport const a = 1;\n`);
    await wf("b.ts", `import "./a";\nexport const b = 1;\n`);
    const g = await DepGraph.build(root);
    // impact must terminate despite the cycle
    const impacted = g.impact("a.ts", { direction: "dependents" });
    expect(impacted.map((i) => i.path)).toContain("b.ts");
    const cycles = g.cycles();
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const members = new Set(cycles.flat());
    expect(members.has("a.ts")).toBe(true);
    expect(members.has("b.ts")).toBe(true);
  });

  it("reports no cycles for an acyclic graph", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-nocycle-"));
    await wf("a.ts", `import "./b";\nexport const a = 1;\n`);
    await wf("b.ts", `export const b = 1;\n`);
    const g = await DepGraph.build(root);
    expect(g.cycles()).toEqual([]);
  });
});
