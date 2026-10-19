import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MapIndex } from "../src/mapindex.js";
import { LiveGraph } from "../src/deps/live.js";
import { registerAllTools, SERVER_INFO, SERVER_OPTIONS } from "../src/server.js";

/**
 * Drift test: the shipped skill must describe the tools that really exist, with
 * their real parameters (see the twin test in packages/memory).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(here, "..", "assets", "kiro", "skills", "repomem-map-structure", "SKILL.md");

let text = "";
let tmp = "";
const schemas = new Map<string, Set<string>>();

beforeAll(async () => {
  text = await fs.readFile(SKILL, "utf8");
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-skill-"));
  await fs.writeFile(path.join(tmp, "a.ts"), "export const a = 1;\n");
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  registerAllTools(server, tmp, await MapIndex.load(tmp), new LiveGraph(tmp));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  for (const t of tools) {
    const props = (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    schemas.set(t.name, new Set(Object.keys(props)));
  }
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function signatures(body: string): Array<{ name: string; params: string[] }> {
  const out: Array<{ name: string; params: string[] }> = [];
  for (const m of body.matchAll(/`([a-z]+(?:_[a-z]+)+)\(([^)]*)\)`/g)) {
    const params = (m[2] ?? "")
      .split(",")
      .map((p) => p.trim().replace(/\?$/, ""))
      .filter((p) => p.length > 0);
    out.push({ name: m[1]!, params });
  }
  return out;
}

describe("map skill matches the real MCP tools", () => {
  it("has frontmatter with the right name and a description", () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(fm).not.toBeNull();
    expect(fm![1]).toMatch(/^name: repomem-map-structure$/m);
    expect(fm![1]).toMatch(/^description: .{40,}/m);
  });

  it("every documented signature names a registered tool", () => {
    const sigs = signatures(text);
    expect(sigs.length).toBeGreaterThan(0);
    for (const s of sigs) expect(schemas.has(s.name), s.name).toBe(true);
  });

  it("every documented parameter exists in that tool's input schema", () => {
    for (const s of signatures(text)) {
      for (const p of s.params) expect(schemas.get(s.name)!.has(p), `${s.name}(${p})`).toBe(true);
    }
  });

  it("documents every registered tool", () => {
    const documented = new Set(signatures(text).map((s) => s.name));
    expect(schemas.size).toBe(7);
    for (const name of schemas.keys()) expect(documented.has(name), name).toBe(true);
  });

  it("tells agents to check dependents BEFORE changing shared code and to refresh summaries AFTER", () => {
    expect(text).toMatch(/get_dependents/);
    expect(text).toMatch(/before/i);
    expect(text).toMatch(/request_summaries/);
    expect(text).toMatch(/after/i);
  });

  it("says open_graph is only a viewer", () => {
    expect(text).toMatch(/open_graph[^\n]*(viewer|does not answer)/i);
  });

  it("is generic and no longer carries a stale-snapshot workaround", () => {
    for (const banned of ["AGENTS.md", "docs/plans", "FastAPI", "dependency_overrides", "config/", "snapshot", "steering"]) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it("still warns that the graph only sees static imports", () => {
    expect(text).toMatch(/static imports/i);
    expect(text).toMatch(/grep/);
  });
});
