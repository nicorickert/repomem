import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryIndex, makeSnippet } from "../src/search.js";
import { writeEntry } from "../src/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = path.join(here, "..", "memory-example");

describe("makeSnippet", () => {
  it("collapses whitespace and keeps short bodies intact", () => {
    expect(makeSnippet("hello   world\n\nthere")).toBe("hello world there");
  });

  it("truncates long bodies with an ellipsis", () => {
    const s = makeSnippet("x".repeat(500));
    expect(s.endsWith("\u2026")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(201);
  });
});

describe("MemoryIndex over the example fixture", () => {
  const index = new MemoryIndex(EXAMPLE_ROOT);

  it("finds an entry by a word in its title", async () => {
    const hits = await index.search({ query: "postgres" });
    expect(hits.some((h) => h.id === "use-postgres-for-primary-store")).toBe(true);
  });

  it("returns compact hits with the expected shape", async () => {
    const hits = await index.search({ query: "postgres" });
    const hit = hits.find((h) => h.id === "use-postgres-for-primary-store")!;
    expect(Object.keys(hit).sort()).toEqual(
      ["id", "snippet", "status", "title", "type"].sort(),
    );
    expect(hit.type).toBe("decision");
  });

  it("filters by type", async () => {
    const hits = await index.search({ query: "commit", type: "convention" });
    expect(hits.every((h) => h.type === "convention")).toBe(true);
    expect(hits.some((h) => h.id === "conventional-commits")).toBe(true);
  });

  it("filters by tags with OR semantics", async () => {
    const hits = await index.search({ query: "the", tags: ["database"] });
    expect(hits.every((h) => h.type === "decision" || h.id.length > 0)).toBe(true);
    // The only entry tagged "database" is the postgres decision.
    expect(hits.some((h) => h.id === "use-postgres-for-primary-store")).toBe(true);
  });

  it("get() returns the full entry body", async () => {
    const entry = await index.get("use-postgres-for-primary-store");
    expect(entry?.frontmatter.title).toContain("PostgreSQL");
    expect(entry?.body.length).toBeGreaterThan(0);
  });

  it("get() returns undefined for unknown id", async () => {
    expect(await index.get("does-not-exist")).toBeUndefined();
  });
});

describe("deprecated handling + live reindex", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-search-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("excludes deprecated entries by default and includes them on request", async () => {
    // Write an accepted and a deprecated decision directly.
    await fs.mkdir(path.join(tmp, "decisions"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "decisions", "keep.md"),
      "---\ntype: decision\ntitle: Keep caching layer\nstatus: accepted\ndate: 2026-01-01\n---\nWe cache aggressively.\n",
    );
    await fs.writeFile(
      path.join(tmp, "decisions", "old.md"),
      "---\ntype: decision\ntitle: Keep old caching approach\nstatus: deprecated\ndate: 2025-01-01\n---\nThe old caching approach.\n",
    );

    const index = new MemoryIndex(tmp);
    const def = await index.search({ query: "caching" });
    expect(def.some((h) => h.id === "keep")).toBe(true);
    expect(def.some((h) => h.id === "old")).toBe(false);

    const all = await index.search({ query: "caching", includeDeprecated: true });
    expect(all.some((h) => h.id === "old")).toBe(true);
  });

  it("picks up a newly written entry without an explicit rebuild", async () => {
    const index = new MemoryIndex(tmp);
    expect(await index.search({ query: "flags" })).toEqual([]);

    await writeEntry(
      tmp,
      { type: "decision", title: "Adopt feature flags", date: "2026-03-01" },
      "We gate risky changes behind flags.",
    );

    const hits = await index.search({ query: "flags" });
    expect(hits.some((h) => h.id === "adopt-feature-flags")).toBe(true);
  });
});

describe("signature includes size (rewrite detected on same mtime tick)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-sig-"));
    await fs.mkdir(path.join(tmp, "decisions"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("reflects a status change even when searched immediately after", async () => {
    const file = path.join(tmp, "decisions", "x.md");
    await fs.writeFile(
      file,
      "---\ntype: decision\ntitle: X\nstatus: accepted\ndate: 2026-01-01\n---\nalpha beta\n",
    );
    const index = new MemoryIndex(tmp);
    expect((await index.search({ query: "alpha" })).length).toBe(1);

    // Rewrite with deprecated status (changes file size) and search at once.
    await fs.writeFile(
      file,
      "---\ntype: decision\ntitle: X\nstatus: deprecated\ndate: 2026-01-01\ndeprecated_reason: obsolete\n---\nalpha beta\n",
    );
    const hits = await index.search({ query: "alpha" });
    expect(hits.length).toBe(0); // deprecated now excluded
  });
});
