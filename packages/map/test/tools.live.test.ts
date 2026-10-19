import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAllTools, SERVER_INFO, SERVER_OPTIONS } from "../src/server.js";
import { MapIndex } from "../src/mapindex.js";
import { LiveGraph } from "../src/deps/live.js";

type ToolCall = { content: Array<{ type: string; text?: string }>; isError?: boolean };
function payloadOf(result: ToolCall): any {
  const first = result.content[0];
  return JSON.parse(first && first.type === "text" ? (first.text ?? "") : "");
}

let root: string;
let client: Client;
let clock: number;
let fileClock = 0;

async function wf(rel: string, content: string): Promise<void> {
  const dest = path.join(root, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
  fileClock += 10;
  const t = new Date(Date.UTC(2030, 0, 1) + fileClock * 1000);
  await fs.utimes(dest, t, t);
}

async function dependents(p: string, depth?: number): Promise<string[]> {
  const res = payloadOf(
    (await client.callTool({ name: "get_dependents", arguments: { path: p, depth } })) as ToolCall,
  );
  return res.found ? res.results.map((r: { path: string }) => r.path).sort() : [];
}

beforeEach(async () => {
  clock = 0;
  fileClock = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-livetools-"));
  await wf("src/model.ts", `export interface User { id: string }\n`);
  await wf("src/repo.ts", `import type { User } from "./model";\nexport const r: User[] = [];\n`);

  const live = new LiveGraph(root, { ttlMs: 1000, now: () => clock });
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  registerAllTools(server, root, await MapIndex.load(root), live);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("dependency tools over a LiveGraph (server keeps running while files change)", () => {
  it("answers from the initial build", async () => {
    expect(await dependents("src/model.ts")).toEqual(["src/repo.ts"]);
  });

  it("a file created mid-session appears in get_dependents", async () => {
    expect(await dependents("src/model.ts")).toEqual(["src/repo.ts"]);

    await wf("src/service.ts", `import { User } from "./model";\nexport const s = (u: User) => u;\n`);
    clock = 5000; // past the TTL
    expect(await dependents("src/model.ts")).toEqual(["src/repo.ts", "src/service.ts"]);
  });

  it("a file created mid-session is itself queryable (it was unknown before)", async () => {
    expect(payloadOf((await client.callTool({ name: "get_dependents", arguments: { path: "src/late.ts" } })) as ToolCall).found).toBe(false);
    await wf("src/late.ts", `import "./repo";\n`);
    clock = 5000;
    expect(await dependents("src/repo.ts")).toEqual(["src/late.ts"]);
    const deps = payloadOf(
      (await client.callTool({ name: "get_dependencies", arguments: { path: "src/late.ts" } })) as ToolCall,
    );
    expect(deps.found).toBe(true);
    expect(deps.results.map((r: { path: string }) => r.path).sort()).toEqual(["src/model.ts", "src/repo.ts"]);
  });

  it("an edit that drops an import removes the dependent", async () => {
    await wf("src/repo.ts", `export const r = [];\n`);
    clock = 5000;
    expect(await dependents("src/model.ts")).toEqual([]);
  });

  it("get_module edges are fresh too", async () => {
    await wf("src/late.ts", `import "./model";\n`);
    clock = 5000;
    const mod = payloadOf(
      (await client.callTool({ name: "get_module", arguments: { path: "src/model.ts" } })) as ToolCall,
    );
    expect(mod.dependents).toEqual(["src/late.ts", "src/repo.ts"]);
  });

  it("a deleted file leaves the graph", async () => {
    await fs.rm(path.join(root, "src/repo.ts"));
    clock = 5000;
    expect(await dependents("src/model.ts")).toEqual([]);
    const gone = payloadOf(
      (await client.callTool({ name: "get_dependents", arguments: { path: "src/repo.ts" } })) as ToolCall,
    );
    expect(gone.found).toBe(false);
  });
});
