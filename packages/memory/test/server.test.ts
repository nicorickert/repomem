import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryIndex } from "../src/search.js";
import { registerReadTools, SERVER_INFO } from "../src/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = path.join(here, "..", "memory-example");

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function textOf(result: ToolCall): string {
  const first = result.content[0];
  return first && first.type === "text" ? (first.text ?? "") : "";
}

describe("MCP read tools (end-to-end over in-memory transport)", () => {
  let client: Client;

  beforeAll(async () => {
    const index = new MemoryIndex(EXAMPLE_ROOT);
    const server = new McpServer(SERVER_INFO);
    registerReadTools(server, index);

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
  });

  it("lists both read tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_memory", "search_memory"]);
  });

  it("search_memory returns compact JSON results", async () => {
    const res = (await client.callTool({
      name: "search_memory",
      arguments: { query: "postgres" },
    })) as ToolCall;
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.count).toBeGreaterThan(0);
    const ids = payload.results.map((r: { id: string }) => r.id);
    expect(ids).toContain("use-postgres-for-primary-store");
    // result shape stays small
    expect(Object.keys(payload.results[0]).sort()).toEqual(
      ["id", "snippet", "status", "title", "type"].sort(),
    );
  });

  it("search_memory honors the type filter", async () => {
    const res = (await client.callTool({
      name: "search_memory",
      arguments: { query: "commit", type: "convention" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(
      payload.results.every((r: { type: string }) => r.type === "convention"),
    ).toBe(true);
  });

  it("get_memory returns the full entry body", async () => {
    const res = (await client.callTool({
      name: "get_memory",
      arguments: { id: "use-postgres-for-primary-store" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.id).toBe("use-postgres-for-primary-store");
    expect(payload.body).toContain("PostgreSQL");
    expect(payload.status).toBe("accepted");
  });

  it("get_memory returns an error result for an unknown id", async () => {
    const res = (await client.callTool({
      name: "get_memory",
      arguments: { id: "nope" },
    })) as ToolCall;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("nope");
  });
});
