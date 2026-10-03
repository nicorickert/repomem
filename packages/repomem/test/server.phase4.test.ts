import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryIndex } from "../src/search.js";
import { registerAllTools, SERVER_INFO } from "../src/server.js";
import { findEntryById } from "../src/store.js";

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };
function parse(res: ToolCall): any {
  const first = res.content[0];
  return JSON.parse(first && first.type === "text" ? (first.text ?? "") : "");
}

async function makeClient(root: string): Promise<Client> {
  const index = new MemoryIndex(root);
  const server = new McpServer(SERVER_INFO);
  registerAllTools(server, root, index);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

describe("phase 4 MCP tools (end-to-end)", () => {
  let tmp: string;
  let client: Client;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-p4e2e-"));
    client = await makeClient(tmp);
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("registers all five tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["deprecate_memory", "get_memory", "memory_for_path", "propose_memory", "search_memory"].sort(),
    );
  });

  it("propose_memory creates a draft and reports it", async () => {
    const res = (await client.callTool({
      name: "propose_memory",
      arguments: {
        type: "decision",
        title: "Cache with Redis",
        body: "Use Redis for the shared cache.",
        tags: ["cache"],
        related_paths: ["src/cache/**"],
      },
    })) as ToolCall;
    const payload = parse(res);
    expect(payload.status).toBe("draft");
    expect(payload.id).toBe("cache-with-redis");

    const entry = await findEntryById(tmp, "cache-with-redis");
    expect(entry?.frontmatter.status).toBe("draft");
  });

  it("propose_memory rejects a duplicate", async () => {
    const args = { type: "decision", title: "Dup", body: "x" };
    await client.callTool({ name: "propose_memory", arguments: args });
    const res = (await client.callTool({ name: "propose_memory", arguments: args })) as ToolCall;
    expect(res.isError).toBe(true);
  });

  it("memory_for_path finds a proposed entry by its glob", async () => {
    await client.callTool({
      name: "propose_memory",
      arguments: {
        type: "convention",
        title: "Cache keys",
        body: "Namespace cache keys.",
        related_paths: ["src/cache/**"],
      },
    });
    const res = (await client.callTool({
      name: "memory_for_path",
      arguments: { path: "src/cache/redis.ts" },
    })) as ToolCall;
    const payload = parse(res);
    expect(payload.results.some((r: any) => r.id === "cache-keys")).toBe(true);
  });

  it("deprecate_memory flips status and is then excluded from search", async () => {
    await client.callTool({
      name: "propose_memory",
      arguments: { type: "learning", title: "Avoid global state", body: "It bites." },
    });
    const dep = (await client.callTool({
      name: "deprecate_memory",
      arguments: { id: "avoid-global-state", reason: "superseded by DI guidance" },
    })) as ToolCall;
    expect(parse(dep).status).toBe("deprecated");

    const search = (await client.callTool({
      name: "search_memory",
      arguments: { query: "global" },
    })) as ToolCall;
    const results = parse(search).results;
    expect(results.some((r: any) => r.id === "avoid-global-state")).toBe(false);
  });

  it("deprecate_memory errors on unknown id", async () => {
    const res = (await client.callTool({
      name: "deprecate_memory",
      arguments: { id: "ghost", reason: "n/a" },
    })) as ToolCall;
    expect(res.isError).toBe(true);
  });
});
