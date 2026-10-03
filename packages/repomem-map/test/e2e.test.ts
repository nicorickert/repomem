import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerGenerationTools, registerQueryTools } from "../src/tools.js";
import { MapIndex } from "../src/mapindex.js";

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };
function payloadOf(result: ToolCall): any {
  const first = result.content[0];
  return JSON.parse(first && first.type === "text" ? (first.text ?? "") : "");
}

async function connect(register: (s: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: "repomem-map", version: "0.0.0" });
  register(server);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-e2e-"));
  await fs.mkdir(path.join(root, "src", "db"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "db", "client.ts"),
    "export function connectPostgres() {}\n",
  );
  await fs.writeFile(
    path.join(root, "src", "auth.ts"),
    "export function login() {}\n",
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("end-to-end: in-agent generation then query (MVP acceptance 6a)", () => {
  it("generates summaries via the agent loop, then finds and reads a module", async () => {
    // Phase 1: generation. The agent requests pending files and saves summaries.
    const gen = await connect((s) => registerGenerationTools(s, root));

    const req = payloadOf(
      (await gen.callTool({ name: "request_summaries", arguments: {} })) as ToolCall,
    );
    expect(req.pending.length).toBe(2);
    expect(req.prompt.length).toBeGreaterThan(0);

    const summaries: Record<string, string> = {
      "src/db/client.ts": "PostgreSQL database connection client.",
      "src/auth.ts": "User login and authentication.",
    };
    for (const item of req.pending) {
      const res = (await gen.callTool({
        name: "save_summary",
        arguments: {
          path: item.path,
          summary: summaries[item.path],
          search_terms: item.path.includes("db")
            ? ["postgres", "database"]
            : ["login", "auth"],
          hash: item.hash,
        },
      })) as ToolCall;
      expect(res.isError).toBeFalsy();
    }

    // Nothing left pending.
    const after = payloadOf(
      (await gen.callTool({ name: "request_summaries", arguments: {} })) as ToolCall,
    );
    expect(after.pending.length).toBe(0);

    // Phase 2: query. A fresh index is loaded from the written summaries.
    const index = await MapIndex.load(root);
    const q = await connect((s) => registerQueryTools(s, index, root));

    const found = payloadOf(
      (await q.callTool({ name: "find_code", arguments: { query: "postgres" } })) as ToolCall,
    );
    expect(found.results.map((r: { path: string }) => r.path)).toContain("src/db/client.ts");

    const mod = payloadOf(
      (await q.callTool({
        name: "get_module",
        arguments: { path: "src/db/client.ts" },
      })) as ToolCall,
    );
    expect(mod.found).toBe(true);
    expect(mod.stale).toBe(false);
    expect(mod.summary).toContain("PostgreSQL");
  });
});
