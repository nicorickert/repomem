import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveMemoryRoot,
  findGitRoot,
  slugify,
  uniqueSlug,
  loadEntries,
  readEntryFile,
  writeEntry,
  existingSlugs,
} from "../src/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = path.join(here, "..", "memory-example");

describe("slugify (option A: ASCII)", () => {
  it("strips diacritics and lowercases", () => {
    expect(slugify("Política de versionado")).toBe("politica-de-versionado");
  });

  it("collapses non-alphanumerics into single hyphens", () => {
    expect(slugify("  Use   PostgreSQL!!  ")).toBe("use-postgresql");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("caps length to 80 chars", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});

describe("uniqueSlug", () => {
  it("returns the slug unchanged when free", () => {
    expect(uniqueSlug("foo", new Set())).toBe("foo");
  });

  it("appends an incrementing suffix on collision", () => {
    expect(uniqueSlug("foo", new Set(["foo"]))).toBe("foo-2");
    expect(uniqueSlug("foo", new Set(["foo", "foo-2"]))).toBe("foo-3");
  });
});

describe("findGitRoot / resolveMemoryRoot", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("--root flag takes precedence over everything", () => {
    const root = resolveMemoryRoot({
      rootFlag: path.join(tmp, "custom"),
      env: { MEMORY_ROOT: path.join(tmp, "env") },
      cwd: tmp,
    });
    expect(root).toBe(path.join(tmp, "custom"));
  });

  it("falls back to MEMORY_ROOT when no flag", () => {
    const root = resolveMemoryRoot({
      env: { MEMORY_ROOT: path.join(tmp, "env") },
      cwd: tmp,
    });
    expect(root).toBe(path.join(tmp, "env"));
  });

  it("falls back to <git root>/.repomem/memory last", async () => {
    await fs.mkdir(path.join(tmp, ".git"));
    const nested = path.join(tmp, "a", "b");
    await fs.mkdir(nested, { recursive: true });
    const root = resolveMemoryRoot({ env: {}, cwd: nested });
    expect(root).toBe(path.join(tmp, ".repomem", "memory"));
  });

  it("finds the git root by walking up", async () => {
    await fs.mkdir(path.join(tmp, ".git"));
    const nested = path.join(tmp, "x", "y", "z");
    await fs.mkdir(nested, { recursive: true });
    expect(findGitRoot(nested)).toBe(tmp);
  });

  it("throws when nothing can be resolved", () => {
    // Use a tmp dir with no .git anywhere up to the fs root is impractical;
    // instead assert the env/flag-less path still returns *something* only
    // when a git root exists. Here we simulate no git root via a deep temp
    // that has no .git and an env without MEMORY_ROOT by pointing cwd at tmp
    // (tmp has no .git). It should either find a parent .git or throw.
    // We only assert it does not silently return undefined.
    expect(() => resolveMemoryRoot({ env: {}, cwd: tmp })).toThrow();
  });
});

describe("loadEntries (fixture: memory-example)", () => {
  it("loads one entry per type from the example root", async () => {
    const entries = await loadEntries(EXAMPLE_ROOT);
    const types = entries.map((e) => e.frontmatter.type).sort();
    expect(types).toEqual(["convention", "decision", "learning", "limitation"]);
  });

  it("derives id from the file slug", async () => {
    const entries = await loadEntries(EXAMPLE_ROOT);
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("use-postgres-for-primary-store");
  });

  it("returns empty for a root with no type folders", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-empty-"));
    try {
      expect(await loadEntries(empty)).toEqual([]);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe("readEntryFile — malformed handling", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-bad-"));
    await fs.mkdir(path.join(tmp, "decisions"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("skips a file with invalid frontmatter (returns undefined)", async () => {
    const f = path.join(tmp, "decisions", "bad.md");
    await fs.writeFile(f, "---\ntype: nonsense\n---\nbody\n");
    expect(await readEntryFile(f, "decision")).toBeUndefined();
  });

  it("skips a file whose declared type mismatches its folder", async () => {
    const f = path.join(tmp, "decisions", "mismatch.md");
    await fs.writeFile(
      f,
      "---\ntype: convention\ntitle: X\ndate: 2026-01-01\n---\nbody\n",
    );
    expect(await readEntryFile(f, "decision")).toBeUndefined();
  });

  it("does not throw when the whole folder has a malformed entry", async () => {
    await fs.writeFile(path.join(tmp, "decisions", "bad.md"), "not valid");
    await expect(loadEntries(tmp)).resolves.toBeInstanceOf(Array);
  });
});

describe("writeEntry — safe, non-overwriting writes", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-write-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes a new entry and derives its id from the title", async () => {
    const r = await writeEntry(
      tmp,
      { type: "decision", title: "Adopt feature flags", date: "2026-03-01" },
      "We will gate risky changes behind flags.",
    );
    expect(r.id).toBe("adopt-feature-flags");

    const back = await readEntryFile(r.path, "decision");
    expect(back?.frontmatter.title).toBe("Adopt feature flags");
    // Default status must be draft, never carried from the writer.
    expect(back?.frontmatter.status).toBe("draft");
  });

  it("assigns a unique slug on title collision instead of overwriting", async () => {
    const base = { type: "decision" as const, date: "2026-03-01" };
    const a = await writeEntry(tmp, { ...base, title: "Same Title" }, "a");
    const b = await writeEntry(tmp, { ...base, title: "Same Title" }, "b");
    expect(a.id).toBe("same-title");
    expect(b.id).toBe("same-title-2");

    const slugs = await existingSlugs(tmp, "decision");
    expect(slugs).toEqual(new Set(["same-title", "same-title-2"]));
  });

  it("round-trips body and list fields", async () => {
    const r = await writeEntry(
      tmp,
      {
        type: "convention",
        title: "Lint on commit",
        date: "2026-03-02",
        tags: ["lint", "git"],
        related_paths: ["**"],
      },
      "Run the linter in a pre-commit hook.",
    );
    const back = await readEntryFile(r.path, "convention");
    expect(back?.frontmatter.tags).toEqual(["lint", "git"]);
    expect(back?.frontmatter.related_paths).toEqual(["**"]);
    expect(back?.body).toBe("Run the linter in a pre-commit hook.");
  });
});
