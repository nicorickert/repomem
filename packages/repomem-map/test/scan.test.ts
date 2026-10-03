import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan } from "../src/scan.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-scan-"));
  // files we expect to be found
  await fs.mkdir(path.join(root, "src", "db"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "index.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(root, "src", "db", "client.ts"), "export const b = 2;\n");
  await fs.writeFile(path.join(root, "README.md"), "# hi\n");
  // dirs that must be excluded
  for (const d of ["node_modules", "dist", ".git", path.join(".repomem", "map")]) {
    await fs.mkdir(path.join(root, d), { recursive: true });
    await fs.writeFile(path.join(root, d, "junk.ts"), "export const z = 0;\n");
  }
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("scan", () => {
  it("lists repo-relative files, excluding node_modules/dist/.git/.repomem", async () => {
    const files = (await scan(root)).sort();
    expect(files).toEqual(
      ["README.md", "src/db/client.ts", "src/index.ts"].sort(),
    );
  });

  it("returns POSIX-style repo-relative paths (no leading root)", async () => {
    const files = await scan(root);
    for (const f of files) {
      expect(path.isAbsolute(f)).toBe(false);
      expect(f.includes("\\")).toBe(false);
    }
  });
});
