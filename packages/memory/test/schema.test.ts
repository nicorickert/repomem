import { describe, it, expect } from "vitest";
import {
  frontmatterSchema,
  isoDate,
  entryTypeSchema,
  TYPE_DIRS,
  ENTRY_TYPES,
} from "../src/schema.js";

describe("frontmatterSchema", () => {
  const minimal = {
    type: "decision",
    title: "Some decision",
    date: "2026-01-01",
  };

  it("applies defaults for status, tags and related_paths", () => {
    const parsed = frontmatterSchema.parse(minimal);
    expect(parsed.status).toBe("draft");
    expect(parsed.tags).toEqual([]);
    expect(parsed.related_paths).toEqual([]);
  });

  it("defaults scope to project when absent", () => {
    const parsed = frontmatterSchema.parse(minimal);
    expect(parsed.scope).toBe("project");
  });

  it("preserves a custom (module) scope", () => {
    const parsed = frontmatterSchema.parse({ ...minimal, scope: "db" });
    expect(parsed.scope).toBe("db");
  });

  it("rejects an empty scope", () => {
    const r = frontmatterSchema.safeParse({ ...minimal, scope: "" });
    expect(r.success).toBe(false);
  });

  it("accepts a fully specified entry", () => {
    const parsed = frontmatterSchema.parse({
      ...minimal,
      status: "accepted",
      author: "me",
      tags: ["a", "b"],
      related_paths: ["src/**"],
      supersedes: "old-slug",
      last_verified: "2026-02-02",
    });
    expect(parsed.status).toBe("accepted");
    expect(parsed.supersedes).toBe("old-slug");
  });

  it("rejects an unknown type", () => {
    const r = frontmatterSchema.safeParse({ ...minimal, type: "idea" });
    expect(r.success).toBe(false);
  });

  it("accepts the context type", () => {
    const r = frontmatterSchema.safeParse({ ...minimal, type: "context" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const r = frontmatterSchema.safeParse({ ...minimal, title: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-ISO date", () => {
    const r = frontmatterSchema.safeParse({ ...minimal, date: "01/02/2026" });
    expect(r.success).toBe(false);
  });

  it("rejects a datetime string where a date is expected", () => {
    const r = frontmatterSchema.safeParse({
      ...minimal,
      date: "2026-01-01T10:00:00Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown frontmatter keys (strict)", () => {
    const r = frontmatterSchema.safeParse({ ...minimal, extra: true });
    expect(r.success).toBe(false);
  });
});

describe("isoDate coercion (YAML parses unquoted dates as Date)", () => {
  it("accepts an ISO date string unchanged", () => {
    expect(isoDate.parse("2026-01-15")).toBe("2026-01-15");
  });

  it("coerces a JS Date to a YYYY-MM-DD string", () => {
    const d = new Date(Date.UTC(2026, 0, 15));
    expect(isoDate.parse(d)).toBe("2026-01-15");
  });

  it("rejects an invalid Date", () => {
    expect(isoDate.safeParse(new Date("not a date")).success).toBe(false);
  });

  it("lets the frontmatter schema accept a Date in the date field", () => {
    const parsed = frontmatterSchema.parse({
      type: "decision",
      title: "Dated via Date object",
      date: new Date(Date.UTC(2026, 2, 1)),
    });
    expect(parsed.date).toBe("2026-03-01");
  });
});

describe("taxonomy", () => {
  it("has a folder for every entry type", () => {
    for (const t of ENTRY_TYPES) {
      expect(TYPE_DIRS[t]).toBeTruthy();
    }
  });

  it("entryTypeSchema matches ENTRY_TYPES", () => {
    for (const t of ENTRY_TYPES) {
      expect(entryTypeSchema.safeParse(t).success).toBe(true);
    }
  });
});
