import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryIndex } from "../src/search.js";
import { registerAllTools, SERVER_INFO, SERVER_OPTIONS } from "../src/server.js";
import { VALIDATE_COMMAND } from "../src/instructions.js";

/**
 * Drift test: the skills shipped to users must describe the tools that really
 * exist, with their real parameters. A skill that names a parameter the server
 * does not have (it once asked for `scope` on propose_memory) or omits a tool
 * makes agents call the API wrongly or not at all.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(here, "..", "assets", "kiro", "skills");
const SKILL_IDS = ["repomem-memory", "repomem-distill"];

const skills = new Map<string, string>();
const schemas = new Map<string, Set<string>>();

beforeAll(async () => {
  for (const id of SKILL_IDS) {
    skills.set(id, await fs.readFile(path.join(SKILLS_DIR, id, "SKILL.md"), "utf8"));
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-skills-"));
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  registerAllTools(server, tmp, new MemoryIndex(tmp));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  for (const t of tools) {
    const props = (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    schemas.set(t.name, new Set(Object.keys(props)));
  }
});

/** `tool_name(arg, other?)` occurrences, i.e. documented signatures. */
function signatures(text: string): Array<{ name: string; params: string[] }> {
  const out: Array<{ name: string; params: string[] }> = [];
  for (const m of text.matchAll(/`([a-z]+(?:_[a-z]+)+)\(([^)]*)\)`/g)) {
    const params = (m[2] ?? "")
      .split(",")
      .map((p) => p.trim().replace(/\?$/, ""))
      .filter((p) => p.length > 0);
    out.push({ name: m[1]!, params });
  }
  return out;
}

const all = (): string => [...skills.values()].join("\n");

describe("memory skills match the real MCP tools", () => {
  it("every skill has frontmatter with a name equal to its folder and a description", () => {
    for (const [id, text] of skills) {
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
      expect(fm, `${id} frontmatter`).not.toBeNull();
      expect(fm![1]).toMatch(new RegExp(`^name: ${id}$`, "m"));
      expect(fm![1]).toMatch(/^description: .{40,}/m);
    }
  });

  it("every documented signature names a registered tool", () => {
    const sigs = signatures(all());
    expect(sigs.length).toBeGreaterThan(0);
    for (const s of sigs) expect(schemas.has(s.name), s.name).toBe(true);
  });

  it("every documented parameter exists in that tool's input schema", () => {
    for (const s of signatures(all())) {
      for (const p of s.params) {
        expect(schemas.get(s.name)!.has(p), `${s.name}(${p})`).toBe(true);
      }
    }
  });

  it("every registered tool is documented in at least one skill", () => {
    const documented = new Set(signatures(all()).map((s) => s.name));
    for (const name of schemas.keys()) expect(documented.has(name), name).toBe(true);
  });

  it("the memory skill covers recall-before-edit and the distill skill covers propose + validate", () => {
    const memory = skills.get("repomem-memory")!;
    expect(memory).toContain("memory_for_path");
    expect(memory).toContain("search_memory");
    const distill = skills.get("repomem-distill")!;
    expect(distill).toContain("propose_memory");
    expect(distill).toContain("deprecate_memory");
    expect(distill).toContain(VALIDATE_COMMAND);
  });

  it("uses the real memory location and never the unscoped npm package", () => {
    const text = all();
    expect(text).toContain(".repomem/memory");
    expect(text).not.toMatch(/npx\s+(-y\s+)?repomem\b/);
    expect(text).not.toMatch(/(?<![.\w/])memory\/(decisions|conventions)/);
  });

  it("is generic: no leftovers from the repository the text was first written for", () => {
    const text = all();
    for (const banned of ["AGENTS.md", "docs/plans", "FastAPI", "dependency_overrides", "steering"]) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it("states that drafts are never accepted by the agent", () => {
    expect(all()).toMatch(/never[^.]*accepted/i);
  });
});
