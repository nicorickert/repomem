import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanSecrets, validateRoot } from "../src/validate.js";
import { writeEntry } from "../src/store.js";

describe("scanSecrets", () => {
  it("flags an AWS access key id", () => {
    const f = scanSecrets("key = AKIAIOSFODNN7EXAMPLE", "x.md");
    expect(f.some((x) => x.rule === "secret:aws-access-key-id")).toBe(true);
  });

  it("flags a private key block", () => {
    const f = scanSecrets("-----BEGIN RSA PRIVATE KEY-----", "x.md");
    expect(f.some((x) => x.rule === "secret:private-key-block")).toBe(true);
  });

  it("flags a github token", () => {
    const f = scanSecrets("token: ghp_" + "a".repeat(36), "x.md");
    expect(f.some((x) => x.rule === "secret:github-token")).toBe(true);
  });

  it("flags a generic api_key assignment with an opaque value", () => {
    const f = scanSecrets('api_key = "abcd1234efgh5678ij"', "x.md");
    expect(f.some((x) => x.rule === "secret:generic-secret-assignment")).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    const f = scanSecrets("We decided to use a token bucket rate limiter.", "x.md");
    expect(f).toEqual([]);
  });

  it("reports the line number", () => {
    const text = "line one\nline two\nAKIAIOSFODNN7EXAMPLE\n";
    const f = scanSecrets(text, "x.md");
    expect(f[0]?.line).toBe(3);
  });
});

describe("validateRoot", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-val-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("passes a clean, valid memory folder", async () => {
    await writeEntry(
      tmp,
      { type: "decision", title: "Clean one", status: "accepted", date: "2026-01-01" },
      "Nothing secret here.",
    );
    const report = await validateRoot(tmp);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(1);
  });

  it("fails on malformed frontmatter (error severity)", async () => {
    await fs.mkdir(path.join(tmp, "decisions"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "decisions", "bad.md"),
      "---\ntype: wrong\n---\nbody\n",
    );
    const report = await validateRoot(tmp);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule === "frontmatter")).toBe(true);
  });

  it("fails on a dangling supersedes reference", async () => {
    await writeEntry(
      tmp,
      {
        type: "decision",
        title: "Replaces missing",
        status: "accepted",
        date: "2026-01-01",
        supersedes: "does-not-exist",
      },
      "body",
    );
    const report = await validateRoot(tmp);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule === "dangling-supersedes")).toBe(true);
  });

  it("accepts a valid supersedes reference", async () => {
    await writeEntry(
      tmp,
      { type: "decision", title: "Old choice", status: "deprecated", date: "2025-01-01" },
      "old",
    );
    await writeEntry(
      tmp,
      {
        type: "decision",
        title: "New choice",
        status: "accepted",
        date: "2026-01-01",
        supersedes: "old-choice",
      },
      "new",
    );
    const report = await validateRoot(tmp);
    expect(report.ok).toBe(true);
  });

  it("fails when an entry contains a secret", async () => {
    await writeEntry(
      tmp,
      { type: "learning", title: "Leaky", status: "accepted", date: "2026-01-01" },
      "Here is a key: AKIAIOSFODNN7EXAMPLE",
    );
    const report = await validateRoot(tmp);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule.startsWith("secret:"))).toBe(true);
  });
});
