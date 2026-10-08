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
import { getRunningViewers, stopAllViewers } from "../src/web/launch.js";

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-open-graph-"));
  await wf("src/a.ts", `import "./b";\nexport const a = 1;\n`);
  await wf("src/b.ts", `export const b = 1;\n`);
});

afterEach(async () => {
  await stopAllViewers();
  await fs.rm(root, { recursive: true, force: true });
});

describe("open_graph tool", () => {
  it("starts a viewer and returns a reachable URL serving /graph", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "open_graph",
      arguments: { port: 0 },
    })) as ToolCall;
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // the viewer should answer /graph with the graph JSON
    const graphRes = await fetch(`${payload.url}/graph`);
    expect(graphRes.status).toBe(200);
    const json = await graphRes.json();
    expect(json.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["src/a.ts", "src/b.ts"]);

    expect(getRunningViewers().length).toBe(1);
  });
});
