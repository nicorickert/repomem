import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCli, parseServers } from "../src/args.js";
import { runInstaller, type Prompter, type Selection } from "../src/run.js";

describe("parseServers", () => {
  it("accepts a comma list", () => {
    expect(parseServers("memory,map")).toEqual({ servers: ["memory", "map"] });
  });

  it("accepts a single id", () => {
    expect(parseServers("memory")).toEqual({ servers: ["memory"] });
  });

  it("expands 'all' to every known server", () => {
    expect(parseServers("all")).toEqual({ servers: ["memory", "map"] });
  });

  it("trims whitespace and de-duplicates", () => {
    expect(parseServers(" memory , memory , map ")).toEqual({ servers: ["memory", "map"] });
  });

  it("rejects unknown ids", () => {
    const r = parseServers("memory,bogus");
    expect(r.servers).toBeUndefined();
    expect(r.error).toContain("bogus");
  });

  it("rejects an empty value", () => {
    expect(parseServers("").error).toBeDefined();
    expect(parseServers("  ").error).toBeDefined();
  });
});

describe("parseCli", () => {
  it("defaults to help with no args", () => {
    expect(parseCli([]).command).toBe("help");
  });

  it("treats --help as help", () => {
    expect(parseCli(["--help"]).command).toBe("help");
  });

  it("flags an unknown command with an error", () => {
    const p = parseCli(["frobnicate"]);
    expect(p.command).toBe("help");
    expect(p.error).toContain("Unknown command");
  });

  it("parses a full non-interactive setup", () => {
    const p = parseCli(["setup", "--agent", "kiro", "--servers", "all", "--force"]);
    expect(p.command).toBe("setup");
    expect(p.agent).toBe("kiro");
    expect(p.servers).toEqual(["memory", "map"]);
    expect(p.force).toBe(true);
    expect(p.nonInteractive).toBe(true);
  });

  it("is interactive when only agent is given", () => {
    const p = parseCli(["setup", "--agent", "kiro"]);
    expect(p.nonInteractive).toBe(false);
    expect(p.servers).toBeUndefined();
  });

  it("is interactive when only servers are given", () => {
    const p = parseCli(["setup", "--servers", "memory"]);
    expect(p.nonInteractive).toBe(false);
    expect(p.agent).toBeUndefined();
  });

  it("surfaces a bad --servers value as an error", () => {
    const p = parseCli(["setup", "--agent", "kiro", "--servers", "nope"]);
    expect(p.error).toContain("nope");
  });

  it("forwards --root", () => {
    expect(parseCli(["setup", "--agent", "kiro", "--servers", "all", "--root", "/x"]).rootFlag).toBe("/x");
  });
});

describe("runInstaller", () => {
  let tmp: string;
  let repoRoot: string;
  let out: string[];
  let err: string[];
  const io = { out: (m: string) => out.push(m), err: (m: string) => err.push(m) };
  const readJson = (p: string): Promise<any> => fs.readFile(p, "utf8").then((s) => JSON.parse(s));
  const kiro = (...parts: string[]) => path.join(repoRoot, ".kiro", ...parts);

  // A prompter that should never be called in non-interactive flows.
  const neverPrompt: Prompter = async () => {
    throw new Error("prompter should not be called");
  };

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-installer-"));
    repoRoot = path.join(tmp, "repo");
    await fs.mkdir(repoRoot, { recursive: true });
    out = [];
    err = [];
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("prints usage and returns 0 for --help", async () => {
    const code = await runInstaller(["--help"], { io, prompt: neverPrompt });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("repomem setup");
  });

  it("returns 1 and prints usage for an unknown command", async () => {
    const code = await runInstaller(["frob"], { io, prompt: neverPrompt });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Unknown command");
  });

  it("configures all servers non-interactively", async () => {
    const code = await runInstaller(
      ["setup", "--agent", "kiro", "--servers", "all", "--root", repoRoot],
      { io, prompt: neverPrompt },
    );
    expect(code).toBe(0);
    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["repomem", "repomem-map"]);
    expect(mcp.mcpServers.repomem.args).toContain("@repomem/memory");
    expect(mcp.mcpServers["repomem-map"].args).toContain("@repomem/map");
    expect(existsSync(kiro("skills", "repomem-memory", "SKILL.md"))).toBe(true);
    expect(existsSync(kiro("skills", "repomem-map-structure", "SKILL.md"))).toBe(true);
  });

  it("configures only the selected server non-interactively", async () => {
    const code = await runInstaller(
      ["setup", "--agent", "kiro", "--servers", "memory", "--root", repoRoot],
      { io, prompt: neverPrompt },
    );
    expect(code).toBe(0);
    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["repomem"]);
  });

  it("uses the prompter when args are incomplete", async () => {
    const selection: Selection = { agent: "kiro", servers: ["map"] };
    const prompt: Prompter = async () => selection;
    const code = await runInstaller(["setup", "--root", repoRoot], { io, prompt });
    expect(code).toBe(0);
    const mcp = await readJson(kiro("settings", "mcp.json"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["repomem-map"]);
  });

  it("returns 1 when the user cancels the prompt", async () => {
    const prompt: Prompter = async () => null;
    const code = await runInstaller(["setup", "--root", repoRoot], { io, prompt });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Cancelled");
  });

  it("returns 1 for a bad --servers value without prompting", async () => {
    const code = await runInstaller(
      ["setup", "--agent", "kiro", "--servers", "nope", "--root", repoRoot],
      { io, prompt: neverPrompt },
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("nope");
  });

  it("rejects an unsupported agent via core validation", async () => {
    const code = await runInstaller(
      ["setup", "--agent", "emacs", "--servers", "memory", "--root", repoRoot],
      { io, prompt: neverPrompt },
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Unsupported agent");
  });
});
