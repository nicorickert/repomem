import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installForKiro, type AgentSetupSpec } from "../src/kiro.js";

let tmp: string;
let repoRoot: string;
let assetRoot: string;

async function makeSkill(id: string, name: string): Promise<string> {
  const dir = path.join(assetRoot, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}.\n---\nBody.\n`,
    "utf8",
  );
  return dir;
}

function readJson(p: string): Promise<any> {
  return fs.readFile(p, "utf8").then((s) => JSON.parse(s));
}

const kiro = (...parts: string[]) => path.join(repoRoot, ".kiro", ...parts);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-kiro-"));
  repoRoot = path.join(tmp, "repo");
  assetRoot = path.join(tmp, "assets");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function repomemSpec(): Promise<AgentSetupSpec> {
  return {
    serverName: "repomem",
    mcpServer: { command: "npx", args: ["-y", "repomem"], autoApprove: ["search_memory"] },
    skills: [{ id: "repomem-memory", srcDir: await makeSkill("repomem-memory", "repomem-memory") }],
  };
}

async function mapSpec(): Promise<AgentSetupSpec> {
  return {
    serverName: "repomem-map",
    mcpServer: { command: "npx", args: ["-y", "repomem-map"] },
    skills: [{ id: "repomem-map-structure", srcDir: await makeSkill("repomem-map-structure", "repomem-map-structure") }],
  };
}

describe("installForKiro", () => {
  it("creates all four artifacts on a fresh workspace", async () => {
    const report = await installForKiro(await repomemSpec(), repoRoot);

    expect(existsSync(kiro("skills", "repomem-memory", "SKILL.md"))).toBe(true);
    expect(existsSync(kiro("agents", "repomem.json"))).toBe(true);
    expect(existsSync(kiro("settings", "mcp.json"))).toBe(true);

    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(mcp.mcpServers.repomem.command).toBe("npx");

    const agent = await readJson(kiro("agents", "repomem.json"));
    expect(agent.name).toBe("repomem");
    expect(agent.mcpServers.repomem).toBeDefined();
    expect(agent.resources).toContain("skill://.kiro/skills/repomem-memory/SKILL.md");

    expect(report.created.length).toBeGreaterThan(0);
  });

  it("is idempotent: a second run does not duplicate servers or resources", async () => {
    await installForKiro(await repomemSpec(), repoRoot);
    await installForKiro(await repomemSpec(), repoRoot);

    const agent = await readJson(kiro("agents", "repomem.json"));
    const uris = agent.resources.filter(
      (r: string) => r === "skill://.kiro/skills/repomem-memory/SKILL.md",
    );
    expect(uris).toHaveLength(1);

    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["repomem"]);
  });

  it("accumulates a second package's server and skill additively", async () => {
    await installForKiro(await repomemSpec(), repoRoot);
    await installForKiro(await mapSpec(), repoRoot);

    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["repomem", "repomem-map"]);

    const agent = await readJson(kiro("agents", "repomem.json"));
    expect(Object.keys(agent.mcpServers).sort()).toEqual(["repomem", "repomem-map"]);
    expect(agent.resources).toContain("skill://.kiro/skills/repomem-memory/SKILL.md");
    expect(agent.resources).toContain("skill://.kiro/skills/repomem-map-structure/SKILL.md");

    expect(existsSync(kiro("skills", "repomem-map-structure", "SKILL.md"))).toBe(true);
  });

  it("preserves a user's foreign mcp server entry", async () => {
    await fs.mkdir(kiro("settings"), { recursive: true });
    await fs.writeFile(
      kiro("settings", "mcp.json"),
      JSON.stringify({ mcpServers: { custom: { command: "mine" } } }, null, 2),
      "utf8",
    );

    await installForKiro(await repomemSpec(), repoRoot);

    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(mcp.mcpServers.custom.command).toBe("mine");
    expect(mcp.mcpServers.repomem.command).toBe("npx");
  });

  it("does not overwrite an existing own server unless force is set", async () => {
    await installForKiro(await repomemSpec(), repoRoot);
    // Tamper with the installed command, then re-run without force.
    const mcpPath = kiro("settings", "mcp.json");
    const mcp = await readJson(mcpPath);
    mcp.mcpServers.repomem.command = "CUSTOM";
    await fs.writeFile(mcpPath, JSON.stringify(mcp, null, 2), "utf8");

    await installForKiro(await repomemSpec(), repoRoot);
    expect((await readJson(mcpPath)).mcpServers.repomem.command).toBe("CUSTOM");

    await installForKiro(await repomemSpec(), repoRoot, { force: true });
    expect((await readJson(mcpPath)).mcpServers.repomem.command).toBe("npx");
  });

  it("copies and merges hooks when provided", async () => {
    const spec = await repomemSpec();
    const scriptPath = path.join(assetRoot, "validate.sh");
    await fs.writeFile(scriptPath, "#!/bin/bash\nexit 0\n", "utf8");
    spec.hookScripts = [{ name: "repomem-validate.sh", srcPath: scriptPath }];
    spec.agentHooks = { agentSpawn: [{ command: ".kiro/hooks/repomem-validate.sh" }] };

    await installForKiro(spec, repoRoot);

    expect(existsSync(kiro("hooks", "repomem-validate.sh"))).toBe(true);
    const agent = await readJson(kiro("agents", "repomem.json"));
    expect(agent.hooks.agentSpawn).toHaveLength(1);

    // Idempotent: hooks are not duplicated.
    await installForKiro(spec, repoRoot);
    const agent2 = await readJson(kiro("agents", "repomem.json"));
    expect(agent2.hooks.agentSpawn).toHaveLength(1);
  });
});
