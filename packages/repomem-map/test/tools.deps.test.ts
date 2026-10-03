import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerQueryTools } from "../src/tools.js";
import { MapIndex } from "../src/mapindex.js";
import { DepGraph } from "../src/deps/graph.js";

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function textOf(result: ToolCall): string {
  const first = result.content[0];
  return first && first.type === "text" ? (first.text ?? "") : "";
}

let root: string;

async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
}

async function makeClient(): Promise<Client> {
  const index = await MapIndex.load(root);
  const graph = await DepGraph.build(root);
  const server = new McpServer({ name: "repomem-map", version: "0.0.0" });
  registerQueryTools(server, index, root, graph);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-deps-tools-"));
  // a -> b -> c
  await wf("src/a.ts", `import "./b";\nexport const a = 1;\n`);
  await wf("src/b.ts", `import "./c";\nexport const b = 1;\n`);
  await wf("src/c.ts", `export const c = 1;\n`);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("get_dependents", () => {
  it("returns the transitive dependents with distances", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_dependents",
      arguments: { path: "src/c.ts" },
    })) as ToolCall;
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.path).toBe("src/c.ts");
    expect(payload.count).toBe(2);
    const paths = payload.results.map((r: { path: string }) => r.path).sort();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("depth:1 limits to direct dependents", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_dependents",
      arguments: { path: "src/c.ts", depth: 1 },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.results.map((r: { path: string }) => r.path)).toEqual(["src/b.ts"]);
  });

  it("reports found:false for an unknown path", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_dependents",
      arguments: { path: "src/missing.ts" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.found).toBe(false);
  });
});

describe("get_dependencies", () => {
  it("returns the transitive dependencies with distances", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_dependencies",
      arguments: { path: "src/a.ts" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.count).toBe(2);
    expect(payload.results.map((r: { path: string }) => r.path).sort()).toEqual([
      "src/b.ts",
      "src/c.ts",
    ]);
  });
});

describe("get_module edges", () => {
  it("includes direct dependencies and dependents", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_module",
      arguments: { path: "src/b.ts" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.dependencies).toEqual(["src/c.ts"]);
    expect(payload.dependents).toEqual(["src/a.ts"]);
  });

  it("works for a file that has no summary (graph is independent of summaries)", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_module",
      arguments: { path: "src/a.ts" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    // no summary exists, but edges still come from the graph
    expect(payload.dependencies).toEqual(["src/b.ts"]);
    expect(payload.dependents).toEqual([]);
  });
});
