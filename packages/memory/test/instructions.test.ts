import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryIndex } from "../src/search.js";
import { registerAllTools, SERVER_INFO, SERVER_OPTIONS } from "../src/server.js";

describe("server instructions (protocol enforcement for any MCP client)", () => {
  let client: Client;
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-instr-"));
    const index = new MemoryIndex(tmp);
    const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
    registerAllTools(server, tmp, index);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
  });

  it("sends non-empty instructions on initialize", () => {
    const text = client.getInstructions();
    expect(text).toBeTruthy();
  });

  it("tells the agent to recall before editing and propose when done", () => {
    const text = client.getInstructions() ?? "";
    expect(text).toContain("memory_for_path");
    expect(text).toContain("search_memory");
    expect(text).toContain("propose_memory");
    expect(text).toContain("deprecate_memory");
  });

  it("gives the scoped validate command and never the unscoped package", () => {
    const text = client.getInstructions() ?? "";
    expect(text).toContain("npx --package @repomem/memory repomem-memory validate");
    expect(text).not.toMatch(/npx -y repomem\b/);
  });

  it("only mentions tools that are actually registered", async () => {
    const text = client.getInstructions() ?? "";
    const { tools } = await client.listTools();
    const registered = new Set(tools.map((t) => t.name));
    const mentioned = text.match(/\b[a-z]+_(?:memory|for_path)\b/g) ?? [];
    expect(mentioned.length).toBeGreaterThan(0);
    for (const name of mentioned) expect(registered.has(name)).toBe(true);
  });
});
