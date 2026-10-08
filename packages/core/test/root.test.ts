import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRepoRoot } from "../src/root.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-root-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("resolveRepoRoot", () => {
  it("prefers an explicit --root flag", () => {
    const out = resolveRepoRoot({ rootFlag: tmp, cwd: "/somewhere/else", env: {} });
    expect(out).toBe(path.resolve(tmp));
  });

  it("falls back to REPOMEM_REPO_ROOT when no flag is given", () => {
    const out = resolveRepoRoot({ cwd: "/nowhere", env: { REPOMEM_REPO_ROOT: tmp } });
    expect(out).toBe(path.resolve(tmp));
  });

  it("discovers the git root by walking up from cwd", async () => {
    await fs.mkdir(path.join(tmp, ".git"));
    const nested = path.join(tmp, "a", "b");
    await fs.mkdir(nested, { recursive: true });

    const out = resolveRepoRoot({ cwd: nested, env: {} });
    expect(out).toBe(path.resolve(tmp));
  });

  it("throws a clear error when nothing resolves", () => {
    // os.tmpdir() ancestors are extremely unlikely to be a git repo, but to be
    // deterministic use the filesystem root as cwd with an empty env.
    expect(() => resolveRepoRoot({ cwd: path.parse(tmp).root, env: {} })).toThrow(
      /Could not resolve a repository root/,
    );
  });
});
