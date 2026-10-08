import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DepGraph } from "../../src/deps/graph.js";

let root: string;

/** Write a file, creating parent dirs. */
async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-graph-"));
  // a -> b -> c ; a also imports an external pkg (ignored)
  await wf("src/a.ts", `import { b } from "./b";\nimport fs from "node:fs";\nexport const a = 1;\n`);
  await wf("src/b.ts", `import { c } from "./c";\nexport const b = 2;\n`);
  await wf("src/c.ts", `export const c = 3;\nexport const c2 = 4;\n`);
  // an unrelated non-code file
  await wf("README.md", "# hi\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("DepGraph.build", () => {
  it("includes all scannable code files as nodes (independent of summaries)", async () => {
    const g = await DepGraph.build(root);
    expect(g.nodes().sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("records direct dependencies (file -> files it imports)", async () => {
    const g = await DepGraph.build(root);
    expect(g.dependencies("src/a.ts")).toEqual(["src/b.ts"]);
    expect(g.dependencies("src/b.ts")).toEqual(["src/c.ts"]);
    expect(g.dependencies("src/c.ts")).toEqual([]);
  });

  it("records direct dependents (reverse edges)", async () => {
    const g = await DepGraph.build(root);
    expect(g.dependents("src/c.ts")).toEqual(["src/b.ts"]);
    expect(g.dependents("src/b.ts")).toEqual(["src/a.ts"]);
    expect(g.dependents("src/a.ts")).toEqual([]);
  });

  it("ignores edges to external (npm/builtin) modules", async () => {
    const g = await DepGraph.build(root);
    // a imports node:fs, which must not become a node or an edge
    expect(g.nodes()).not.toContain("node:fs");
    expect(g.dependencies("src/a.ts")).toEqual(["src/b.ts"]);
  });

  it("exposes per-node metrics: fan-in, fan-out, imports, exports", async () => {
    const g = await DepGraph.build(root);
    const b = g.metrics("src/b.ts");
    expect(b).not.toBeNull();
    expect(b!.fanOut).toBe(1); // imports c
    expect(b!.fanIn).toBe(1); // imported by a
    expect(b!.imports).toBe(1); // one in-repo import (node:fs excluded? imports counts raw)
    expect(b!.exports).toBe(1);
    const c = g.metrics("src/c.ts");
    expect(c!.exports).toBe(2);
    expect(c!.fanOut).toBe(0);
    expect(c!.fanIn).toBe(1);
  });

  it("returns null metrics / empty edges for unknown paths", async () => {
    const g = await DepGraph.build(root);
    expect(g.metrics("src/missing.ts")).toBeNull();
    expect(g.dependencies("src/missing.ts")).toEqual([]);
    expect(g.dependents("src/missing.ts")).toEqual([]);
  });
});
