/**
 * schema.ts — zod schemas for entry frontmatter and parsed entries.
 *
 * Defines the entry taxonomy (type/status), the frontmatter schema (with
 * defaults for status/tags/related_paths), and the full MemoryEntry shape
 * that pairs validated frontmatter with the markdown body and derived id.
 */

import * as z from "zod";

/** The four kinds of memory entry. */
export const ENTRY_TYPES = [
  "decision",
  "convention",
  "limitation",
  "learning",
] as const;

/** Lifecycle of an entry. New entries always start as `draft`. */
export const ENTRY_STATUSES = ["draft", "accepted", "deprecated"] as const;

export const entryTypeSchema = z.enum(ENTRY_TYPES);
export const entryStatusSchema = z.enum(ENTRY_STATUSES);

export type EntryType = z.infer<typeof entryTypeSchema>;
export type EntryStatus = z.infer<typeof entryStatusSchema>;

/**
 * Map from entry type to the folder that holds entries of that type.
 * Files live at `memory/<type>s/<slug>.md`.
 */
export const TYPE_DIRS: Record<EntryType, string> = {
  decision: "decisions",
  convention: "conventions",
  limitation: "limitations",
  learning: "learnings",
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An ISO calendar date (`YYYY-MM-DD`), accepted either as a string or as a
 * `Date`. YAML parsers (gray-matter) turn an unquoted `date: 2026-01-15` into
 * a JS `Date`, so we coerce both forms to a normalized `YYYY-MM-DD` string.
 */
export const isoDate = z
  .union([z.string(), z.date()])
  .transform((v, ctx) => {
    if (v instanceof Date) {
      if (Number.isNaN(v.getTime())) {
        ctx.addIssue({ code: "custom", message: "invalid date" });
        return z.NEVER;
      }
      return v.toISOString().slice(0, 10);
    }
    return v;
  })
  .refine((s) => ISO_DATE_RE.test(s), {
    message: "must be an ISO date (YYYY-MM-DD)",
  });

/**
 * Frontmatter as it appears at the top of a memory markdown file.
 *
 * Defaults mirror the product rules: status defaults to `draft`, and the
 * list fields default to empty so a minimal entry only needs type/title/date.
 */
export const frontmatterSchema = z
  .object({
    type: entryTypeSchema,
    title: z.string().min(1, "title must not be empty"),
    status: entryStatusSchema.default("draft"),
    date: isoDate,
    author: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).default([]),
    related_paths: z.array(z.string().min(1)).default([]),
    supersedes: z.string().min(1).optional(),
    last_verified: isoDate.optional(),
  })
  .strict();

/** Frontmatter after parsing (defaults applied). */
export type Frontmatter = z.infer<typeof frontmatterSchema>;

/** Frontmatter as accepted on input (defaults still optional). */
export type FrontmatterInput = z.input<typeof frontmatterSchema>;

/**
 * A fully parsed memory entry: its id (file slug), validated frontmatter,
 * the markdown body, and the absolute path it was read from.
 */
export interface MemoryEntry {
  /** The file slug, e.g. `versioning-policy`. Unique within a type folder. */
  id: string;
  /** Validated and defaulted frontmatter. */
  frontmatter: Frontmatter;
  /** Markdown body (everything after the frontmatter block). */
  body: string;
  /** Absolute path to the source file. */
  path: string;
}

export const SCHEMA_FIELDS = Object.freeze({
  types: ENTRY_TYPES,
  statuses: ENTRY_STATUSES,
});
