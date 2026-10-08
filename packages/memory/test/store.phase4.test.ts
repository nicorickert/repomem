import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  proposeEntry,
  deprecateEntry,
  entriesForPath,
  findEntryById,
  readEntryFile,
  writeEntry,
} from "../src/store.js";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-p4-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("proposeEntry", () => {
  it("always writes status draft, even if caller is ignored", async () => {
    const r = await proposeEntry(tmp, {
      type: "decision",
      title: "Adopt trunk-based development",
      body: "Short-lived branches only.",
    });
    expect(r.id).toBe("adopt-trunk-based-development");
    const back = await readEntryFile(r.path, "decision");
    expect(back?.frontmatter.status).toBe("draft");
    // date defaults to today (ISO shape)
    expect(back?.frontmatter.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects a duplicate title within the same type", async () => {
    await proposeEntry(tmp, { type: "decision", title: "Same One", body: "a" });
    await expect(
      proposeEntry(tmp, { type: "decision", title: "Same One", body: "b" }),
    ).rejects.toThrow(/already exists/);
  });

  it("allows the same title under a different type", async () => {
    await proposeEntry(tmp, { type: "decision", title: "Shared", body: "a" });
    const r = await proposeEntry(tmp, {
      type: "convention",
      title: "Shared",
      body: "b",
    });
    expect(r.id).toBe("shared");
  });

  it("persists tags, related_paths and supersedes", async () => {
    const r = await proposeEntry(tmp, {
      type: "convention",
      title: "Lint before commit",
      body: "Run the linter.",
      tags: ["lint"],
      related_paths: ["src/**"],
      supersedes: "old-rule",
    });
    const back = await readEntryFile(r.path, "convention");
    expect(back?.frontmatter.tags).toEqual(["lint"]);
    expect(back?.frontmatter.related_paths).toEqual(["src/**"]);
    expect(back?.frontmatter.supersedes).toBe("old-rule");
  });

  it("rejects a title that produces an empty slug", async () => {
    await expect(
      proposeEntry(tmp, { type: "learning", title: "!!!", body: "x" }),
    ).rejects.toThrow(/usable slug/);
  });
});

describe("deprecateEntry", () => {
  it("sets status to deprecated and records the reason in place", async () => {
    const created = await proposeEntry(tmp, {
      type: "decision",
      title: "Use library X",
      body: "We use X.",
    });
    const r = await deprecateEntry(tmp, created.id, "X is unmaintained", "use-library-y");
    expect(r.path).toBe(created.path); // same file, rewritten in place

    const back = await findEntryById(tmp, created.id);
    expect(back?.frontmatter.status).toBe("deprecated");
    expect(back?.frontmatter.deprecated_reason).toBe("X is unmaintained");
    expect(back?.frontmatter.superseded_by).toBe("use-library-y");
    // body preserved
    expect(back?.body).toBe("We use X.");
  });

  it("throws for an unknown id", async () => {
    await expect(deprecateEntry(tmp, "nope", "because")).rejects.toThrow(/no memory entry/);
  });

  it("requires a non-empty reason", async () => {
    const c = await proposeEntry(tmp, { type: "learning", title: "Thing", body: "b" });
    await expect(deprecateEntry(tmp, c.id, "   ")).rejects.toThrow(/reason/);
  });
});

describe("entriesForPath", () => {
  beforeEach(async () => {
    await writeEntry(
      tmp,
      {
        type: "decision",
        title: "DB access rules",
        status: "accepted",
        date: "2026-01-01",
        related_paths: ["src/db/**"],
      },
      "Only the repository layer touches the db.",
    );
    await writeEntry(
      tmp,
      {
        type: "convention",
        title: "DB draft note",
        status: "draft",
        date: "2026-02-01",
        related_paths: ["src/db/**"],
      },
      "Draft guidance.",
    );
    await writeEntry(
      tmp,
      {
        type: "learning",
        title: "Old db lesson",
        status: "deprecated",
        date: "2025-01-01",
        related_paths: ["src/db/**"],
      },
      "Deprecated lesson.",
    );
    await writeEntry(
      tmp,
      {
        type: "convention",
        title: "Frontend only",
        status: "accepted",
        date: "2026-01-01",
        related_paths: ["web/**"],
      },
      "Unrelated.",
    );
  });

  it("matches entries whose globs cover the path", async () => {
    const hits = await entriesForPath(tmp, "src/db/queries.ts");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("db-access-rules");
    expect(ids).not.toContain("frontend-only");
  });

  it("excludes deprecated entries", async () => {
    const hits = await entriesForPath(tmp, "src/db/queries.ts");
    expect(hits.some((h) => h.frontmatter.status === "deprecated")).toBe(false);
  });

  it("prioritizes accepted before draft", async () => {
    const hits = await entriesForPath(tmp, "src/db/queries.ts");
    expect(hits[0]?.frontmatter.status).toBe("accepted");
  });

  it("returns empty when nothing matches", async () => {
    expect(await entriesForPath(tmp, "docs/readme.md")).toEqual([]);
  });

  it("normalizes a leading ./ and os separators", async () => {
    const hits = await entriesForPath(tmp, "./src/db/queries.ts");
    expect(hits.some((h) => h.id === "db-access-rules")).toBe(true);
  });
});
