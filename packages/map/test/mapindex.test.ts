import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MapIndex, isStale } from "../src/mapindex.js";
import { hashContent, writeSummary, type SummaryRecord } from "../src/summary.js";

let root: string;

function rec(content: string, summary: string, terms: string[]): SummaryRecord {
  return {
    hash: hashContent(content),
    summary,
    search_terms: terms,
    model: "agent",
    generated_at: new Date().toISOString(),
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-index-"));
  await fs.mkdir(path.join(root, "src", "db"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "db", "client.ts"), "pg client\n");
  await fs.writeFile(path.join(root, "src", "auth.ts"), "login logic\n");
  await writeSummary(
    root,
    "src/db/client.ts",
    rec("pg client\n", "PostgreSQL database connection client.", ["postgres", "database"]),
  );
  await writeSummary(
    root,
    "src/auth.ts",
    rec("login logic\n", "Handles user authentication and login.", ["auth", "login"]),
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("isStale", () => {
  it("is false when the record hash matches the current content", () => {
    const r = rec("pg client\n", "x", ["y"]);
    expect(isStale(r, "pg client\n")).toBe(false);
  });

  it("is true when the content changed", () => {
    const r = rec("pg client\n", "x", ["y"]);
    expect(isStale(r, "different\n")).toBe(true);
  });
});

describe("MapIndex", () => {
  it("loads summaries and finds a file by a word in its summary", async () => {
    const index = await MapIndex.load(root);
    const hits = index.search("postgres");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toBe("src/db/client.ts");
  });

  it("finds a file by a search_term", async () => {
    const index = await MapIndex.load(root);
    const hits = index.search("login");
    expect(hits.map((h) => h.path)).toContain("src/auth.ts");
  });

  it("get(path) returns the stored record, or null when absent", async () => {
    const index = await MapIndex.load(root);
    const got = index.get("src/auth.ts");
    expect(got).not.toBeNull();
    expect(got!.summary).toContain("authentication");
    expect(index.get("src/missing.ts")).toBeNull();
  });

  it("upsert adds a summary for a path that had none", async () => {
    const index = await MapIndex.load(root);
    expect(index.search("rabbitmq")).toHaveLength(0);
    index.upsert("src/queue.ts", rec("q\n", "RabbitMQ message queue consumer.", ["amqp"]));
    expect(index.search("rabbitmq").map((h) => h.path)).toEqual(["src/queue.ts"]);
    expect(index.search("amqp").map((h) => h.path)).toEqual(["src/queue.ts"]);
    expect(index.get("src/queue.ts")!.summary).toContain("RabbitMQ");
  });

  it("upsert replaces an existing summary, so the old terms stop matching", async () => {
    const index = await MapIndex.load(root);
    expect(index.search("postgres").map((h) => h.path)).toContain("src/db/client.ts");
    index.upsert(
      "src/db/client.ts",
      rec("pg client\n", "SQLite embedded storage adapter.", ["sqlite"]),
    );
    expect(index.search("sqlite").map((h) => h.path)).toEqual(["src/db/client.ts"]);
    expect(index.search("postgres")).toHaveLength(0);
    expect(index.get("src/db/client.ts")!.summary).toContain("SQLite");
  });
});
