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
    for (const d of ["decisions", "conventions", "limitations", "learnings"]) {
      expect(existsSync(path.join(root, d))).toBe(true);
    }
    expect(existsSync(path.join(root, "README.md"))).toBe(true);
    expect(existsSync(path.join(root, "templates", "decision.md"))).toBe(true);
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
