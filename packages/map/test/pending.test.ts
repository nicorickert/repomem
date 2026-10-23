import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
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

  it("stops after `limit` files instead of walking the whole repo", async () => {
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(path.join(root, "src", `f${i}.ts`), `export const n = ${i};\n`);
    }
    const result = await pending(root, { limit: 3 });
    expect(result).toHaveLength(3);
    // Without a limit the full list is still returned.
    expect(await pending(root)).toHaveLength(10);
  });

  it("skips files larger than the size cap", async () => {
    await fs.writeFile(path.join(root, "src", "small.ts"), "export {};\n");
    await fs.writeFile(path.join(root, "src", "huge.ts"), "x".repeat(2048));
    const result = await pending(root, { maxBytes: 1024 });
    expect(result.map((p) => p.path)).toEqual(["src/small.ts"]);
  });

  it("does not throw on a listed path that is missing or not a regular file", async () => {
    await fs.writeFile(path.join(root, "src", "ok.ts"), "export {};\n");
    await fs.writeFile(path.join(root, "gone.ts"), "export {};\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "gone.ts"], { cwd: root });
    await fs.rm(path.join(root, "gone.ts")); // tracked but deleted
    const result = await pending(root);
    expect(result.map((p) => p.path)).toEqual(["src/ok.ts"]);
  });
});
