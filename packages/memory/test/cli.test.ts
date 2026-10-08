import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../src/cli.js";

let tmp: string;
let root: string;
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-cli-"));
  root = path.join(tmp, "memory");
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(async () => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("repomem init", () => {
  it("creates the folder structure, README and templates", async () => {
    const code = await run(["init", "--root", root]);
    expect(code).toBe(0);
    for (const d of ["decisions", "conventions", "limitations", "learnings", "contexts"]) {
      expect(existsSync(path.join(root, d))).toBe(true);
    }
    expect(existsSync(path.join(root, "README.md"))).toBe(true);
    expect(existsSync(path.join(root, "templates", "decision.md"))).toBe(true);
    expect(existsSync(path.join(root, "templates", "context.md"))).toBe(true);
  });

  it("writes a README that lists the contexts/ folder", async () => {
    await run(["init", "--root", root]);
    const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
    expect(readme).toContain("contexts/");
  });

  it("is idempotent and does not overwrite an existing README", async () => {
    await run(["init", "--root", root]);
    await fs.writeFile(path.join(root, "README.md"), "CUSTOM", "utf8");
    const code = await run(["init", "--root", root]);
    expect(code).toBe(0);
    expect(await fs.readFile(path.join(root, "README.md"), "utf8")).toBe("CUSTOM");
  });
});

describe("repomem validate", () => {
  it("exits 0 on a clean memory folder", async () => {
    await run(["init", "--root", root]);
    const code = await run(["validate", "--root", root]);
    expect(code).toBe(0);
  });

  it("exits 1 when a secret is present", async () => {
    await run(["init", "--root", root]);
    await fs.writeFile(
      path.join(root, "decisions", "leak.md"),
      "---\ntype: decision\ntitle: Leak\nstatus: accepted\ndate: 2026-01-01\n---\nAKIAIOSFODNN7EXAMPLE\n",
    );
    const code = await run(["validate", "--root", root]);
    expect(code).toBe(1);
  });

  it("exits 1 on malformed frontmatter", async () => {
    await run(["init", "--root", root]);
    await fs.writeFile(
      path.join(root, "decisions", "bad.md"),
      "---\ntype: nope\n---\nbody\n",
    );
    const code = await run(["validate", "--root", root]);
    expect(code).toBe(1);
  });

  it("exits 1 when the memory folder does not exist", async () => {
    const code = await run(["validate", "--root", path.join(tmp, "nope")]);
    expect(code).toBe(1);
  });
});

describe("usage / unknown command", () => {
  it("returns 1 for an unknown command", async () => {
    const code = await run(["frobnicate", "--root", root]);
    expect(code).toBe(1);
  });

  it("returns 0 for explicit --help", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
  });
});

describe("repomem setup", () => {
  it("installs skills, agent config and MCP settings for kiro", async () => {
    const code = await run(["setup", "--agent", "kiro", "--root", tmp]);
    expect(code).toBe(0);

    expect(existsSync(path.join(tmp, ".kiro", "skills", "repomem-memory", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(tmp, ".kiro", "skills", "repomem-distill", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(tmp, ".kiro", "agents", "repomem.json"))).toBe(true);
    expect(existsSync(path.join(tmp, ".kiro", "settings", "mcp.json"))).toBe(true);

    const mcp = JSON.parse(
      await fs.readFile(path.join(tmp, ".kiro", "settings", "mcp.json"), "utf8"),
    );
    expect(mcp.mcpServers.repomem.command).toBe("npx");
    expect(mcp.mcpServers.repomem.args).toEqual([
      "-y",
      "--package",
      "@repomem/memory",
      "repomem-memory",
      "serve",
    ]);
    expect(mcp.mcpServers.repomem.autoApprove).toContain("search_memory");

    const agent = JSON.parse(
      await fs.readFile(path.join(tmp, ".kiro", "agents", "repomem.json"), "utf8"),
    );
    expect(agent.resources).toContain("skill://.kiro/skills/repomem-memory/SKILL.md");
    expect(agent.resources).toContain("skill://.kiro/skills/repomem-distill/SKILL.md");
  });

  it("is idempotent on a second run", async () => {
    await run(["setup", "--agent", "kiro", "--root", tmp]);
    const code = await run(["setup", "--agent", "kiro", "--root", tmp]);
    expect(code).toBe(0);

    const agent = JSON.parse(
      await fs.readFile(path.join(tmp, ".kiro", "agents", "repomem.json"), "utf8"),
    );
    const uris = agent.resources.filter(
      (r: string) => r === "skill://.kiro/skills/repomem-memory/SKILL.md",
    );
    expect(uris).toHaveLength(1);
  });

  it("returns 1 for an unsupported agent", async () => {
    const code = await run(["setup", "--agent", "emacs", "--root", tmp]);
    expect(code).toBe(1);
  });

  it("returns 1 when --agent is missing", async () => {
    const code = await run(["setup", "--root", tmp]);
    expect(code).toBe(1);
  });

  it("ships a skill with name and description frontmatter", async () => {
    await run(["setup", "--agent", "kiro", "--root", tmp]);
    const skill = await fs.readFile(
      path.join(tmp, ".kiro", "skills", "repomem-memory", "SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(/^---\n/);
    expect(skill).toMatch(/\nname: /);
    expect(skill).toMatch(/\ndescription: /);
  });
});
