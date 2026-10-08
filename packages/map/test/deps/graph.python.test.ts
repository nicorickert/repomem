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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-graph-py-"));
  // Package layout:
  //   pkg/__init__.py
  //   pkg/mod.py        imports pkg.sub.leaf (absolute) + stdlib os (external)
  //   pkg/sub/__init__.py
  //   pkg/sub/leaf.py   from ..mod import nothing-real -> edge to pkg/mod.py
  //   app.py            from pkg.sub import leaf ; from . import nothing
  await wf("pkg/__init__.py", "");
  await wf(
    "pkg/mod.py",
    ["import os", "from pkg.sub.leaf import z", "def public(): pass", "def _hidden(): pass"].join("\n") + "\n",
  );
  await wf("pkg/sub/__init__.py", "");
  await wf(
    "pkg/sub/leaf.py",
    ["from ..mod import public", "__all__ = ['z']", "z = 3"].join("\n") + "\n",
  );
  await wf(
    "app.py",
    ["from pkg.sub import leaf", "import numpy", "class App: pass"].join("\n") + "\n",
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("DepGraph.build (Python)", () => {
  it("includes every Python file as a node", async () => {
    const g = await DepGraph.build(root);
    expect(g.nodes().sort()).toEqual([
      "app.py",
      "pkg/__init__.py",
      "pkg/mod.py",
      "pkg/sub/__init__.py",
      "pkg/sub/leaf.py",
    ]);
  });

  it("records in-repo import edges and ignores stdlib/third-party", async () => {
    const g = await DepGraph.build(root);
    expect(g.dependencies("pkg/mod.py")).toEqual(["pkg/sub/leaf.py"]);
    expect(g.dependencies("pkg/sub/leaf.py")).toEqual(["pkg/mod.py"]);
    expect(g.dependencies("app.py")).toEqual(["pkg/sub/__init__.py"]);
    // No external nodes leaked in.
    expect(g.nodes()).not.toContain("os");
    expect(g.nodes()).not.toContain("numpy");
  });

  it("records reverse edges (dependents)", async () => {
    const g = await DepGraph.build(root);
    expect(g.dependents("pkg/mod.py")).toEqual(["pkg/sub/leaf.py"]);
    expect(g.dependents("pkg/sub/leaf.py")).toEqual(["pkg/mod.py"]);
    expect(g.dependents("pkg/sub/__init__.py")).toEqual(["app.py"]);
  });

  it("exposes per-node metrics with Python export counts", async () => {
    const g = await DepGraph.build(root);
    const mod = g.metrics("pkg/mod.py")!;
    expect(mod.imports).toBe(2); // os + pkg.sub.leaf (raw count)
    expect(mod.fanOut).toBe(1); // only pkg.sub.leaf is in-repo
    expect(mod.exports).toBe(1); // public (not _hidden)

    const leaf = g.metrics("pkg/sub/leaf.py")!;
    expect(leaf.exports).toBe(1); // __all__ = ['z']

    const app = g.metrics("app.py")!;
    expect(app.exports).toBe(1); // class App
  });

  it("detects the pkg.mod <-> pkg.sub.leaf cycle", async () => {
    const g = await DepGraph.build(root);
    const cycles = g.cycles();
    const hasCycle = cycles.some(
      (c) => c.includes("pkg/mod.py") && c.includes("pkg/sub/leaf.py"),
    );
    expect(hasCycle).toBe(true);
  });
});
