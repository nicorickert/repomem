import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyIfAbsent,
  copyExecutable,
  ensureDir,
  deepMergeAdditive,
  mergeJsonAdditive,
  mergeReports,
  emptyReport,
} from "../src/fsops.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-fsops-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("copyIfAbsent", () => {
  it("creates a new file and reports it as created", async () => {
    const src = path.join(tmp, "src.txt");
    const dest = path.join(tmp, "nested", "dest.txt");
    await fs.writeFile(src, "hello", "utf8");

    const report = await copyIfAbsent(src, dest);

    expect(existsSync(dest)).toBe(true);
    expect(await fs.readFile(dest, "utf8")).toBe("hello");
    expect(report.created).toEqual([dest]);
    expect(report.skipped).toEqual([]);
  });

  it("does not overwrite an existing file and reports it as skipped", async () => {
    const src = path.join(tmp, "src.txt");
    const dest = path.join(tmp, "dest.txt");
    await fs.writeFile(src, "new", "utf8");
    await fs.writeFile(dest, "original", "utf8");

    const report = await copyIfAbsent(src, dest);

    expect(await fs.readFile(dest, "utf8")).toBe("original");
    expect(report.skipped).toEqual([dest]);
    expect(report.created).toEqual([]);
  });
});

describe("copyExecutable", () => {
  it("creates the file with the executable bit set", async () => {
    const src = path.join(tmp, "hook.sh");
    const dest = path.join(tmp, "out", "hook.sh");
    await fs.writeFile(src, "#!/bin/bash\necho hi\n", "utf8");

    const report = await copyExecutable(src, dest);
    expect(report.created).toEqual([dest]);

    // Executable by owner.
    await expect(fs.access(dest, fsConstants.X_OK)).resolves.toBeUndefined();
  });

  it("skips an existing file without touching permissions", async () => {
    const src = path.join(tmp, "hook.sh");
    const dest = path.join(tmp, "hook.sh.dest");
    await fs.writeFile(src, "new", "utf8");
    await fs.writeFile(dest, "original", "utf8");

    const report = await copyExecutable(src, dest);
    expect(report.skipped).toEqual([dest]);
    expect(await fs.readFile(dest, "utf8")).toBe("original");
  });
});

describe("deepMergeAdditive", () => {
  it("adds keys only present in the patch", () => {
    const out = deepMergeAdditive({ a: 1 }, { b: 2 }, false);
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it("keeps existing scalar values when not forcing", () => {
    const out = deepMergeAdditive({ a: 1 }, { a: 2 }, false);
    expect(out).toEqual({ a: 1 });
  });

  it("overwrites existing scalar values when forcing", () => {
    const out = deepMergeAdditive({ a: 1 }, { a: 2 }, true);
    expect(out).toEqual({ a: 2 });
  });

  it("recursively merges nested objects, preserving foreign keys", () => {
    const base = { mcpServers: { other: { command: "x" } } };
    const patch = { mcpServers: { repomem: { command: "npx" } } };
    const out = deepMergeAdditive(base, patch, false);
    expect(out).toEqual({
      mcpServers: { other: { command: "x" }, repomem: { command: "npx" } },
    });
  });

  it("does not mutate its inputs", () => {
    const base = { a: { b: 1 } };
    const patch = { a: { c: 2 } };
    deepMergeAdditive(base, patch, false);
    expect(base).toEqual({ a: { b: 1 } });
  });
});

describe("mergeJsonAdditive", () => {
  it("creates the file when absent and reports created", async () => {
    const dest = path.join(tmp, "settings", "mcp.json");
    const report = await mergeJsonAdditive(dest, { mcpServers: { repomem: { command: "npx" } } });

    expect(report.created).toEqual([dest]);
    const parsed = JSON.parse(await fs.readFile(dest, "utf8"));
    expect(parsed).toEqual({ mcpServers: { repomem: { command: "npx" } } });
  });

  it("merges additively into an existing file, preserving foreign servers", async () => {
    const dest = path.join(tmp, "mcp.json");
    await fs.writeFile(
      dest,
      JSON.stringify({ mcpServers: { other: { command: "foo" } } }, null, 2),
      "utf8",
    );

    const report = await mergeJsonAdditive(dest, {
      mcpServers: { repomem: { command: "npx" } },
    });

    expect(report.merged).toEqual([dest]);
    const parsed = JSON.parse(await fs.readFile(dest, "utf8"));
    expect(parsed.mcpServers).toEqual({
      other: { command: "foo" },
      repomem: { command: "npx" },
    });
  });

  it("keeps an existing own entry unless force is set", async () => {
    const dest = path.join(tmp, "mcp.json");
    await fs.writeFile(
      dest,
      JSON.stringify({ mcpServers: { repomem: { command: "OLD" } } }),
      "utf8",
    );

    await mergeJsonAdditive(dest, { mcpServers: { repomem: { command: "NEW" } } });
    let parsed = JSON.parse(await fs.readFile(dest, "utf8"));
    expect(parsed.mcpServers.repomem.command).toBe("OLD");

    await mergeJsonAdditive(
      dest,
      { mcpServers: { repomem: { command: "NEW" } } },
      { force: true },
    );
    parsed = JSON.parse(await fs.readFile(dest, "utf8"));
    expect(parsed.mcpServers.repomem.command).toBe("NEW");
  });

  it("treats an empty file as an empty object", async () => {
    const dest = path.join(tmp, "mcp.json");
    await fs.writeFile(dest, "   ", "utf8");
    const report = await mergeJsonAdditive(dest, { a: 1 });
    expect(report.merged).toEqual([dest]);
    expect(JSON.parse(await fs.readFile(dest, "utf8"))).toEqual({ a: 1 });
  });
});

describe("report helpers", () => {
  it("mergeReports concatenates all buckets", () => {
    const a = emptyReport();
    a.created.push("c1");
    const b = emptyReport();
    b.skipped.push("s1");
    b.merged.push("m1");
    const out = mergeReports(a, b);
    expect(out).toEqual({ created: ["c1"], skipped: ["s1"], merged: ["m1"] });
  });

  it("ensureDir creates nested directories idempotently", async () => {
    const dir = path.join(tmp, "a", "b", "c");
    await ensureDir(dir);
    await ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });
});
