import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryIndex } from "../src/search.js";
import { registerAllTools, SERVER_INFO, SERVER_OPTIONS } from "../src/server.js";

/**
 * Tool descriptions are the one piece of text every MCP client shows the
 * model, even when it ignores server `instructions`. They must tell the agent
 * WHEN to call the tool, not only what it does.
 */
describe("prescriptive tool descriptions", () => {
  const desc = new Map<string, string>();
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-desc-"));
    const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
    registerAllTools(server, tmp, new MemoryIndex(tmp));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const { tools } = await client.listTools();
    for (const t of tools) desc.set(t.name, t.description ?? "");
  });

  it("memory_for_path says to call it BEFORE modifying a file", () => {
    expect(desc.get("memory_for_path")).toMatch(/before (you )?(modify|edit|chang)/i);
  });

  it("search_memory says to call it BEFORE starting and once per concept", () => {
    const d = desc.get("search_memory") ?? "";
    expect(d).toMatch(/before/i);
    expect(d).toMatch(/per (main )?concept/i);
  });

  it("propose_memory says to call it when the task is done and that it is always a draft", () => {
    const d = desc.get("propose_memory") ?? "";
    expect(d).toMatch(/(after|when) (you )?(finish|complet|the task)/i);
    expect(d).toMatch(/draft/i);
    expect(d).toMatch(/never.*accepted|accepted.*human/i);
  });

  it("deprecate_memory says to use it when work makes an entry false", () => {
    const d = desc.get("deprecate_memory") ?? "";
    expect(d).toMatch(/(false|obsolete|contradict)/i);
    expect(d).toMatch(/supersedes/i);
  });

  it("keeps every tool described", () => {
    for (const name of [
      "search_memory",
      "get_memory",
      "memory_for_path",
      "propose_memory",
      "deprecate_memory",
    ]) {
      expect((desc.get(name) ?? "").length).toBeGreaterThan(40);
    }
  });
});
