import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSetup, runSetupMany } from "../src/command.js";
import type { AgentSetupSpec } from "../src/kiro.js";

let tmp: string;
let repoRoot: string;
let assetRoot: string;
let out: string[];
let err: string[];

const io = {
  out: (m: string) => out.push(m),
  err: (m: string) => err.push(m),
};

async function makeSkill(id: string): Promise<string> {
  const dir = path.join(assetRoot, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${id}\ndescription: Test skill ${id}.\n---\nBody.\n`,
    "utf8",
  );
  return dir;
}

async function memorySpec(): Promise<AgentSetupSpec> {
  return {
    serverName: "repomem",
    mcpServer: { command: "npx", args: ["-y", "--package", "@repomem/memory", "repomem-memory", "serve"] },
    skills: [{ id: "repomem-memory", srcDir: await makeSkill("repomem-memory") }],
  };
}

async function mapSpec(): Promise<AgentSetupSpec> {
  return {
    serverName: "repomem-map",
    mcpServer: { command: "npx", args: ["-y", "--package", "@repomem/map", "repomem-map", "serve"] },
    skills: [{ id: "repomem-map-structure", srcDir: await makeSkill("repomem-map-structure") }],
  };
}

const kiro = (...parts: string[]) => path.join(repoRoot, ".kiro", ...parts);
const readJson = (p: string): Promise<any> => fs.readFile(p, "utf8").then((s) => JSON.parse(s));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-cmd-"));
  repoRoot = path.join(tmp, "repo");
  assetRoot = path.join(tmp, "assets");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  out = [];
  err = [];
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runSetupMany", () => {
  it("configures multiple specs against one repo root", async () => {
    const code = await runSetupMany(
      [await memorySpec(), await mapSpec()],
      { agent: "kiro", rootFlag: repoRoot },
      io,
    );

    expect(code).toBe(0);
    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["repomem", "repomem-map"]);
    expect(mcp.mcpServers.repomem.args).toEqual([
      "-y",
      "--package",
      "@repomem/memory",
      "repomem-memory",
      "serve",
    ]);
    expect(existsSync(kiro("skills", "repomem-memory", "SKILL.md"))).toBe(true);
    expect(existsSync(kiro("skills", "repomem-map-structure", "SKILL.md"))).toBe(true);
    // One "Configured ..." line per spec.
    expect(out.filter((l) => l.startsWith("Configured")).length).toBe(2);
  });

  it("rejects a missing agent", async () => {
    const code = await runSetupMany([await memorySpec()], { rootFlag: repoRoot }, io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("requires --agent");
  });

  it("rejects an unsupported agent", async () => {
    const code = await runSetupMany(
      [await memorySpec()],
      { agent: "nope", rootFlag: repoRoot },
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Unsupported agent");
  });

  it("rejects an empty spec list", async () => {
    const code = await runSetupMany([], { agent: "kiro", rootFlag: repoRoot }, io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("at least one server");
  });
});

describe("runSetup (single spec, delegates to runSetupMany)", () => {
  it("configures one spec", async () => {
    const code = await runSetup(await memorySpec(), { agent: "kiro", rootFlag: repoRoot }, io);
    expect(code).toBe(0);
    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["repomem"]);
  });

  it("rejects a missing agent", async () => {
    const code = await runSetup(await memorySpec(), { rootFlag: repoRoot }, io);
    expect(code).toBe(1);
  });
});
