import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hashContent,
  summaryPathFor,
  writeSummary,
  readSummary,
  type SummaryRecord,
} from "../src/summary.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-summary-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("hashContent", () => {
  it("is a stable, deterministic sha256 hex digest", () => {
    const a = hashContent("hello world");
    const b = hashContent("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the content changes", () => {
    expect(hashContent("one")).not.toBe(hashContent("two"));
  });
});

describe("summaryPathFor", () => {
  it("mirrors the code path under .repomem/map/summaries and appends .json", () => {
    const root = "/repo";
    const p = summaryPathFor(root, "src/db/client.ts");
    expect(p).toBe(
      path.join("/repo", ".repomem", "map", "summaries", "src/db/client.ts.json"),
    );
  });
});

describe("writeSummary / readSummary round-trip", () => {
  it("writes a JSON summary and reads it back identically", async () => {
    const record: SummaryRecord = {
      hash: hashContent("export const x = 1;"),
      summary: "Exports a constant x.",
      search_terms: ["constant", "x", "export"],
      model: "agent",
      generated_at: new Date().toISOString(),
    };
    await writeSummary(tmp, "src/x.ts", record);

    // JSON lands in the mirrored path
    const onDisk = summaryPathFor(tmp, "src/x.ts");
    const raw = await fs.readFile(onDisk, "utf8");
    expect(JSON.parse(raw)).toEqual(record);

    const read = await readSummary(tmp, "src/x.ts");
    expect(read).toEqual(record);
  });

  it("readSummary returns null for a path without a summary", async () => {
    const read = await readSummary(tmp, "src/missing.ts");
    expect(read).toBeNull();
  });
});
