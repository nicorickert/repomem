import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SERVER_INFO } from "../src/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(here, "..", "package.json"), "utf8"),
) as { name: string; version: string };

describe("server version", () => {
  it("is the version in package.json, not a hardcoded placeholder", () => {
    expect(SERVER_INFO.version).toBe(pkg.version);
    expect(SERVER_INFO.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is reported to the client on initialize", async () => {
    const server = new McpServer(SERVER_INFO);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    expect(client.getServerVersion()).toMatchObject({
      name: SERVER_INFO.name,
      version: pkg.version,
    });
  });
});
