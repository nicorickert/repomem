import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pending } from "../src/pending.js";
import { hashContent, writeSummary, type SummaryRecord } from "../src/summary.js";

let root: string;

function recordFor(content: string): SummaryRecord {
  return {
    hash: hashContent(content),
    summary: "s",
    search_terms: ["t"],
    model: "agent",
    generated_at: new Date().toISOString(),
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-pending-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("pending", () => {
  it("lists a file that has no summary yet, with its current hash", async () => {
    await fs.writeFile(path.join(root, "src", "new.ts"), "export const n = 1;\n");
    const result = await pending(root);
    expect(result).toEqual([
      { path: "src/new.ts", hash: hashContent("export const n = 1;\n") },
    ]);
  });

  it("lists a file whose summary hash is stale (content changed)", async () => {
    const file = path.join(root, "src", "changed.ts");
    await fs.writeFile(file, "old\n");
    await writeSummary(root, "src/changed.ts", recordFor("old\n"));
    // content changes after the summary was written
    await fs.writeFile(file, "new content\n");

    const result = await pending(root);
    expect(result).toEqual([
      { path: "src/changed.ts", hash: hashContent("new content\n") },
    ]);
  });

  it("ignores files whose summary hash matches the current content", async () => {
    const file = path.join(root, "src", "fresh.ts");
    await fs.writeFile(file, "same\n");
    await writeSummary(root, "src/fresh.ts", recordFor("same\n"));

    const result = await pending(root);
    expect(result).toEqual([]);
  });
});
