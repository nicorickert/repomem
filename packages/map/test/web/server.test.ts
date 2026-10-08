import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DepGraph } from "../../src/deps/graph.js";
import { startWebServer, type WebServerHandle } from "../../src/web/server.js";

let root: string;
let handle: WebServerHandle | null = null;

async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-web-"));
  await wf("src/api/a.ts", `import "./b";\nexport const a = 1;\n`);
  await wf("src/api/b.ts", `import "../core/c";\nexport const b = 1;\n`);
  await wf("src/core/c.ts", `export const c = 1;\n`);
});

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe("startWebServer", () => {
  it("serves the full graph as JSON on GET /graph", async () => {
    const graph = await DepGraph.build(root);
    handle = await startWebServer({ root, graph, port: 0 });
    const res = await fetch(`${handle.url}/graph`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    const ids = json.nodes.map((n: { id: string }) => n.id).sort();
    expect(ids).toEqual(["src/api/a.ts", "src/api/b.ts", "src/core/c.ts"]);
    expect(Array.isArray(json.edges)).toBe(true);
    expect(Array.isArray(json.cycles)).toBe(true);
  });

  it("applies the scope query parameter", async () => {
    const graph = await DepGraph.build(root);
    handle = await startWebServer({ root, graph, port: 0 });
    const res = await fetch(`${handle.url}/graph?scope=src/api`);
    const json = await res.json();
    const ids = json.nodes.map((n: { id: string }) => n.id).sort();
    expect(ids).toEqual(["src/api/a.ts", "src/api/b.ts"]);
  });

  it("applies focus + depth query parameters", async () => {
    const graph = await DepGraph.build(root);
    handle = await startWebServer({ root, graph, port: 0 });
    const res = await fetch(`${handle.url}/graph?focus=src/api/a.ts&depth=1`);
    const json = await res.json();
    const ids = json.nodes.map((n: { id: string }) => n.id).sort();
    expect(ids).toEqual(["src/api/a.ts", "src/api/b.ts"]);
  });

  it("applies the ignore query parameter (comma-separated prefixes)", async () => {
    const graph = await DepGraph.build(root);
    handle = await startWebServer({ root, graph, port: 0 });
    const res = await fetch(`${handle.url}/graph?ignore=src/core, src/api/a.ts`);
    const json = await res.json();
    const ids = json.nodes.map((n: { id: string }) => n.id).sort();
    expect(ids).toEqual(["src/api/b.ts"]);
  });

  it("returns 404 for an unknown path", async () => {
    const graph = await DepGraph.build(root);
    handle = await startWebServer({ root, graph, port: 0 });
    const res = await fetch(`${handle.url}/nope`);
    expect(res.status).toBe(404);
  });

  it("serves the index page at /", async () => {
    const graph = await DepGraph.build(root);
    const staticDir = path.join(root, "static");
    await fs.mkdir(staticDir, { recursive: true });
    await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>viewer</title>");
    handle = await startWebServer({ root, graph, port: 0, staticDir });
    const res = await fetch(`${handle.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("viewer");
  });
});
