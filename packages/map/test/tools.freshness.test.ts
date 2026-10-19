import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAllTools } from "../src/server.js";
import { MapIndex } from "../src/mapindex.js";

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };
function payloadOf(result: ToolCall): any {
  const first = result.content[0];
  return JSON.parse(first && first.type === "text" ? (first.text ?? "") : "");
}

let root: string;
let client: Client;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-fresh-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "billing.ts"), "export const invoice = 1;\n");
  // The index is loaded ONCE, at "server start", like the real bootstrap does.
  const index = await MapIndex.load(root);
  const server = new McpServer({ name: "repomem-map", version: "0.0.0" });
  registerAllTools(server, root, index);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function save(summary: string, terms: string[]): Promise<void> {
  const req = payloadOf(
    (await client.callTool({ name: "request_summaries", arguments: {} })) as ToolCall,
  );
  const item = req.pending.find((p: { path: string }) => p.path === "src/billing.ts");
  const res = (await client.callTool({
    name: "save_summary",
    arguments: { path: "src/billing.ts", summary, search_terms: terms, hash: item.hash },
  })) as ToolCall;
  expect(res.isError).toBeFalsy();
}

describe("a saved summary is visible in the same session (no server restart)", () => {
  it("find_code finds a term that was saved after startup", async () => {
    const before = payloadOf(
      (await client.callTool({ name: "find_code", arguments: { query: "invoicing" } })) as ToolCall,
    );
    expect(before.count).toBe(0);

    await save("Invoicing and billing totals.", ["invoicing"]);

    const after = payloadOf(
      (await client.callTool({ name: "find_code", arguments: { query: "invoicing" } })) as ToolCall,
    );
    expect(after.results.map((r: { path: string }) => r.path)).toEqual(["src/billing.ts"]);
  });

  it("get_module returns the NEW summary, not a stale cached one, after a re-save", async () => {
    await save("First draft of the billing summary.", ["first"]);
    await fs.writeFile(path.join(root, "src", "billing.ts"), "export const invoice = 2;\n");
    await save("Second revision of the billing summary.", ["second"]);

    const mod = payloadOf(
      (await client.callTool({ name: "get_module", arguments: { path: "src/billing.ts" } })) as ToolCall,
    );
    expect(mod.found).toBe(true);
    expect(mod.summary).toContain("Second revision");
    expect(mod.stale).toBe(false);

    const old = payloadOf(
      (await client.callTool({ name: "find_code", arguments: { query: "first" } })) as ToolCall,
    );
    expect(old.count).toBe(0);
  });
});
