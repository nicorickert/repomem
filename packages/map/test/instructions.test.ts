import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAllTools, SERVER_INFO, SERVER_OPTIONS } from "../src/server.js";
import { MapIndex } from "../src/mapindex.js";
import { DepGraph } from "../src/deps/graph.js";

let root: string;
let client: Client;
const desc = new Map<string, string>();

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-instr-"));
  await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  registerAllTools(server, root, await MapIndex.load(root), await DepGraph.build(root));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  for (const t of tools) desc.set(t.name, t.description ?? "");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("map server instructions (protocol enforcement for any MCP client)", () => {
  it("sends non-empty instructions on initialize", () => {
    expect(client.getInstructions()).toBeTruthy();
  });

  it("tells the agent to check the blast radius before changing shared code", () => {
    const text = client.getInstructions() ?? "";
    expect(text).toContain("get_dependents");
    expect(text).toContain("get_dependencies");
    expect(text).toMatch(/depth/);
  });

  it("covers locating code and refreshing summaries when done", () => {
    const text = client.getInstructions() ?? "";
    for (const tool of ["find_code", "get_module", "request_summaries", "save_summary"]) {
      expect(text).toContain(tool);
    }
  });

  it("explains that open_graph is only a viewer", () => {
    expect(client.getInstructions() ?? "").toMatch(/open_graph[^.]*viewer/i);
  });

  it("only mentions tools that are actually registered", () => {
    const text = client.getInstructions() ?? "";
    const mentioned = [
      ...new Set(text.match(/\b(?:get|find|request|save|open)_[a-z_]+\b/g) ?? []),
    ];
    expect(mentioned.length).toBeGreaterThan(0);
    for (const name of mentioned) expect(desc.has(name), name).toBe(true);
  });
});

describe("map prescriptive tool descriptions", () => {
  it("get_dependents says to call it BEFORE changing a shared symbol", () => {
    const d = desc.get("get_dependents") ?? "";
    expect(d).toMatch(/before (you )?(chang|modif|edit)/i);
    expect(d).toMatch(/depth/);
  });

  it("get_dependencies says to call it before moving or splitting a file", () => {
    expect(desc.get("get_dependencies")).toMatch(/before (you )?(mov|split|chang)/i);
  });

  it("find_code says an empty result on a young map is not proof the code is absent", () => {
    expect(desc.get("find_code")).toMatch(/empty/i);
    expect(desc.get("find_code")).toMatch(/summar/i);
  });

  it("request_summaries / save_summary say to run them after finishing", () => {
    expect(desc.get("request_summaries")).toMatch(/after (you )?(finish|chang|complet)/i);
    expect(desc.get("save_summary")).toMatch(/hash/i);
  });

  it("open_graph says it only starts a viewer and does not answer queries", () => {
    expect(desc.get("open_graph")).toMatch(/does not answer queries|only a viewer|viewer only/i);
  });
});
