import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DepGraph } from "../../src/deps/graph.js";
import { scan } from "../../src/scan.js";

let root: string;
let clock = 0;

/** Write a file and force a distinct mtime so change detection never depends on fs timestamp granularity. */
async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
  clock += 10;
  const t = new Date(Date.UTC(2030, 0, 1) + clock * 1000);
  await fs.utimes(dest, t, t);
}

/** Everything observable about a graph, for exact comparison. */
function snapshot(g: DepGraph) {
  return g
    .nodes()
    .sort()
    .map((n) => ({
      n,
      deps: g.dependencies(n),
      dependents: g.dependents(n),
      metrics: g.metrics(n),
    }));
}

/** The incremental graph must be indistinguishable from a build from scratch. */
async function expectSameAsFreshBuild(g: DepGraph): Promise<void> {
  expect(snapshot(g)).toEqual(snapshot(await DepGraph.build(root)));
}

beforeEach(async () => {
  clock = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-sync-"));
  // a -> b -> c
  await wf("src/a.ts", `import "./b";\nexport const a = 1;\n`);
  await wf("src/b.ts", `import "./c";\nexport const b = 1;\n`);
  await wf("src/c.ts", `export const c = 1;\n`);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("DepGraph.sync (incremental update from the current file list)", () => {
  it("reparses nothing when nothing changed", async () => {
    const g = await DepGraph.build(root);
    const before = snapshot(g);
    const report = await g.sync(await scan(root));
    expect(report.reparsed).toEqual([]);
    expect(report.relinked).toBe(false);
    expect(snapshot(g)).toEqual(before);
  });

  it("an edited file is the only one reparsed, and its edges are replaced", async () => {
    const g = await DepGraph.build(root);
    await wf("src/a.ts", `import "./c";\nexport const a = 1;\n`); // a: b -> c
    const report = await g.sync(await scan(root));
    expect(report.reparsed).toEqual(["src/a.ts"]);
    expect(report.relinked).toBe(false);
    expect(g.dependencies("src/a.ts")).toEqual(["src/c.ts"]);
    expect(g.dependents("src/b.ts")).toEqual([]);
    expect(g.dependents("src/c.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    await expectSameAsFreshBuild(g);
  });

  it("a created file shows up with its edges and only it is parsed", async () => {
    const g = await DepGraph.build(root);
    await wf("src/d.ts", `import "./a";\nexport const d = 1;\n`);
    const report = await g.sync(await scan(root));
    expect(report.reparsed).toEqual(["src/d.ts"]);
    expect(g.has("src/d.ts")).toBe(true);
    expect(g.dependents("src/a.ts")).toEqual(["src/d.ts"]);
    await expectSameAsFreshBuild(g);
  });

  it("a deleted file disappears together with the edges that pointed at it", async () => {
    const g = await DepGraph.build(root);
    await fs.rm(path.join(root, "src/b.ts"));
    const report = await g.sync(await scan(root));
    expect(report.reparsed).toEqual([]);
    expect(g.has("src/b.ts")).toBe(false);
    expect(g.dependencies("src/a.ts")).toEqual([]);
    expect(g.dependents("src/c.ts")).toEqual([]);
    await expectSameAsFreshBuild(g);
  });

  it("creating the target of a previously unresolved import adds the edge without reparsing the importer", async () => {
    await wf("src/a.ts", `import "./b";\nimport "./later";\nexport const a = 1;\n`);
    const g = await DepGraph.build(root);
    expect(g.dependencies("src/a.ts")).toEqual(["src/b.ts"]);

    await wf("src/later.ts", `export const later = 1;\n`);
    const report = await g.sync(await scan(root));
    expect(report.reparsed).toEqual(["src/later.ts"]); // a.ts is NOT reparsed
    expect(report.relinked).toBe(true);
    expect(g.dependencies("src/a.ts")).toEqual(["src/b.ts", "src/later.ts"]);
    await expectSameAsFreshBuild(g);
  });

  it("deleting a file then recreating it restores the original graph", async () => {
    const g = await DepGraph.build(root);
    const original = snapshot(g);
    await fs.rm(path.join(root, "src/c.ts"));
    await g.sync(await scan(root));
    expect(g.dependencies("src/b.ts")).toEqual([]);
    await wf("src/c.ts", `export const c = 1;\n`);
    await g.sync(await scan(root));
    expect(snapshot(g)).toEqual(original);
  });

  it("a tsconfig alias change re-resolves imports from the cache, without reparsing code", async () => {
    await wf("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@x/*": ["src/*"] } } }));
    await wf("src/app.ts", `import "@x/c";\n`);
    const g = await DepGraph.build(root);
    expect(g.dependencies("src/app.ts")).toEqual(["src/c.ts"]);

    await wf("src/lib/c.ts", `export const c = 9;\n`);
    await wf("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@x/*": ["src/lib/*"] } } }));
    const report = await g.sync(await scan(root));
    expect(report.reparsed).toEqual(["src/lib/c.ts"]); // app.ts not reparsed
    expect(g.dependencies("src/app.ts")).toEqual(["src/lib/c.ts"]);
    await expectSameAsFreshBuild(g);
  });

  it("a mixed batch of edit + create + delete ends identical to a fresh build", async () => {
    const g = await DepGraph.build(root);
    await wf("src/a.ts", `import "./c";\nimport "./e";\n`);
    await wf("src/e.ts", `import "./a";\n`); // creates a cycle a <-> e
    await fs.rm(path.join(root, "src/b.ts"));
    const report = await g.sync(await scan(root));
    expect(report.reparsed.sort()).toEqual(["src/a.ts", "src/e.ts"]);
    await expectSameAsFreshBuild(g);
    expect(g.cycles()).toEqual([["src/a.ts", "src/e.ts"]]);
  });

  it("a file listed but missing on disk is ignored instead of failing the sync", async () => {
    const g = await DepGraph.build(root);
    const files = [...(await scan(root)), "src/ghost.ts"];
    const report = await g.sync(files);
    expect(report.reparsed).toEqual([]);
    expect(g.has("src/ghost.ts")).toBe(false);
  });
});
