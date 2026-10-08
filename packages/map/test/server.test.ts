import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAllTools, SERVER_INFO } from "../src/server.js";
import { MapIndex } from "../src/mapindex.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-server-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("SERVER_INFO", () => {
  it("identifies the map server", () => {
    expect(SERVER_INFO.name).toBe("repomem-map");
    expect(typeof SERVER_INFO.version).toBe("string");
  });
});

describe("registerAllTools", () => {
  it("registers exactly the four MVP tools", async () => {
    const index = await MapIndex.load(root);
    const server = new McpServer(SERVER_INFO);
    expect(() => registerAllTools(server, root, index)).not.toThrow();

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["find_code", "get_module", "request_summaries", "save_summary"].sort(),
    );
  });
});
