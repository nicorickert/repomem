import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerQueryTools } from "../src/tools.js";
import { MapIndex } from "../src/mapindex.js";
import { hashContent, writeSummary, type SummaryRecord } from "../src/summary.js";

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function textOf(result: ToolCall): string {
  const first = result.content[0];
  return first && first.type === "text" ? (first.text ?? "") : "";
}

function rec(content: string, summary: string, terms: string[]): SummaryRecord {
  return {
    hash: hashContent(content),
    summary,
    search_terms: terms,
    model: "agent",
    generated_at: new Date().toISOString(),
  };
}

let root: string;

async function makeClient(): Promise<Client> {
  const index = await MapIndex.load(root);
  const server = new McpServer({ name: "repomem-map", version: "0.0.0" });
  registerQueryTools(server, index, root);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-query-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "auth.ts"), "login logic\n");
  await writeSummary(
    root,
    "src/auth.ts",
    rec("login logic\n", "Handles user authentication and login.", ["auth", "login"]),
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("find_code", () => {
  it("returns hits for a query matching a summary", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "find_code",
      arguments: { query: "authentication" },
    })) as ToolCall;
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.results.map((r: { path: string }) => r.path)).toContain("src/auth.ts");
  });
});

describe("get_module", () => {
  it("returns the summary with stale:false when content matches", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_module",
      arguments: { path: "src/auth.ts" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.path).toBe("src/auth.ts");
    expect(payload.stale).toBe(false);
    expect(payload.summary).toContain("authentication");
    expect(payload.search_terms).toContain("auth");
  });

  it("returns stale:true when the file content changed", async () => {
    // mutate the file AFTER the index/summary were created
    await fs.writeFile(path.join(root, "src", "auth.ts"), "totally different now\n");
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_module",
      arguments: { path: "src/auth.ts" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.stale).toBe(true);
  });

  it("returns a clear result for a path with no summary", async () => {
    const client = await makeClient();
    const res = (await client.callTool({
      name: "get_module",
      arguments: { path: "src/unknown.ts" },
    })) as ToolCall;
    const payload = JSON.parse(textOf(res));
    expect(payload.found).toBe(false);
    expect(payload.path).toBe("src/unknown.ts");
  });
});
