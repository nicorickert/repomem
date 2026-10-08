import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, run } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to the serve command with no args", () => {
    const { command, rootFlag } = parseArgs([]);
    expect(command).toBe("serve");
    expect(rootFlag).toBeUndefined();
  });

  it("treats an explicit serve the same way", () => {
    expect(parseArgs(["serve"]).command).toBe("serve");
  });

  it("reads --root", () => {
    const { command, rootFlag } = parseArgs(["serve", "--root", "/tmp/repo"]);
    expect(command).toBe("serve");
    expect(rootFlag).toBe("/tmp/repo");
  });

  it("recognizes help", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
  });

  it("recognizes the graph command and reads --port", () => {
    const { command, portFlag } = parseArgs(["graph", "--port", "1234"]);
    expect(command).toBe("graph");
    expect(portFlag).toBe(1234);
  });

  it("reads --root alongside graph", () => {
    const { command, rootFlag, portFlag } = parseArgs(["graph", "--root", "/tmp/repo"]);
    expect(command).toBe("graph");
    expect(rootFlag).toBe("/tmp/repo");
    expect(portFlag).toBeUndefined();
  });

  it("recognizes the setup command and reads --agent/--force", () => {
    const parsed = parseArgs(["setup", "--agent", "kiro", "--force"]);
    expect(parsed.command).toBe("setup");
    expect(parsed.agentFlag).toBe("kiro");
    expect(parsed.force).toBe(true);
  });
});

describe("repomem-map setup", () => {
  let tmp: string;
  let outSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-cli-"));
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(async () => {
    outSpy.mockRestore();
    errSpy.mockRestore();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const kiro = (...p: string[]) => path.join(tmp, ".kiro", ...p);
  const readJson = (p: string) => fs.readFile(p, "utf8").then((s) => JSON.parse(s));

  it("installs the map skill and MCP config for kiro", async () => {
    const code = await run(["setup", "--agent", "kiro", "--root", tmp]);
    expect(code).toBe(0);

    expect(existsSync(kiro("skills", "repomem-map-structure", "SKILL.md"))).toBe(true);
    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(mcp.mcpServers["repomem-map"].command).toBe("npx");
    expect(mcp.mcpServers["repomem-map"].args).toEqual([
      "-y",
      "--package",
      "@repomem/map",
      "repomem-map",
      "serve",
    ]);
  });

  it("returns 1 for an unsupported agent", async () => {
    expect(await run(["setup", "--agent", "vim", "--root", tmp])).toBe(1);
  });

  it("coexists additively with repomem setup in the same workspace", async () => {
    // Simulate a prior `repomem setup` having written its own server + skill.
    await fs.mkdir(kiro("settings"), { recursive: true });
    await fs.writeFile(
      kiro("settings", "mcp.json"),
      JSON.stringify({ mcpServers: { repomem: { command: "npx", args: ["-y", "repomem"] } } }, null, 2),
      "utf8",
    );
    await fs.mkdir(kiro("agents"), { recursive: true });
    await fs.writeFile(
      kiro("agents", "repomem.json"),
      JSON.stringify(
        {
          name: "repomem",
          mcpServers: { repomem: { command: "npx", args: ["-y", "repomem"] } },
          resources: ["skill://.kiro/skills/repomem-memory/SKILL.md"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await run(["setup", "--agent", "kiro", "--root", tmp]);
    expect(code).toBe(0);

    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["repomem", "repomem-map"]);

    const agent = await readJson(kiro("agents", "repomem.json"));
    expect(Object.keys(agent.mcpServers).sort()).toEqual(["repomem", "repomem-map"]);
    expect(agent.resources).toContain("skill://.kiro/skills/repomem-memory/SKILL.md");
    expect(agent.resources).toContain("skill://.kiro/skills/repomem-map-structure/SKILL.md");
  });
});
