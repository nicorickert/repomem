import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scan } from "../src/scan.js";

let root: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

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

  it("excludes common dependency, build-output and cache directories at any depth", async () => {
    const junk = [
      ".venv/lib/python3.12/site-packages",
      "venv",
      "target/debug",
      "build",
      ".next/server",
      "coverage",
      "__pycache__",
      "vendor/lib",
      "packages/app/node_modules/x",
      "packages/app/out",
    ];
    for (const d of junk) {
      await fs.mkdir(path.join(root, d), { recursive: true });
      await fs.writeFile(path.join(root, d, "junk.ts"), "export const z = 0;\n");
      await fs.writeFile(path.join(root, d, "junk.py"), "import os\n");
    }
    const files = (await scan(root)).sort();
    expect(files).toEqual(["README.md", "src/db/client.ts", "src/index.ts"].sort());
  });

  it("returns POSIX-style repo-relative paths (no leading root)", async () => {
    const files = await scan(root);
    for (const f of files) {
      expect(path.isAbsolute(f)).toBe(false);
      expect(f.includes("\\")).toBe(false);
    }
  });

  it("skips files with binary extensions", async () => {
    await fs.writeFile(path.join(root, "logo.png"), "x");
    await fs.writeFile(path.join(root, "lib.SO"), "x");
    await fs.writeFile(path.join(root, "src", "data.parquet"), "x");
    const files = (await scan(root)).sort();
    expect(files).toEqual(["README.md", "src/db/client.ts", "src/index.ts"].sort());
  });
});

describe("scan inside a git repository", () => {
  beforeEach(async () => {
    git(root, "init", "-q");
    await fs.writeFile(path.join(root, ".gitignore"), "generated/\n*.log\n");
  });

  it("respects .gitignore, including directories not in IGNORED_DIRS", async () => {
    await fs.mkdir(path.join(root, "generated", "deep"), { recursive: true });
    await fs.writeFile(path.join(root, "generated", "deep", "big.py"), "x = 1\n");
    await fs.writeFile(path.join(root, "debug.log"), "noise\n");
    const files = (await scan(root)).sort();
    expect(files).toEqual(["README.md", "src/db/client.ts", "src/index.ts"].sort());
  });

  it("respects a nested .gitignore (e.g. a sample's own cdk.out/)", async () => {
    await fs.mkdir(path.join(root, "samples", "a", "cdk.out"), { recursive: true });
    await fs.writeFile(path.join(root, "samples", "a", ".gitignore"), "/cdk.out/\n");
    await fs.writeFile(path.join(root, "samples", "a", "app.py"), "x = 1\n");
    await fs.writeFile(path.join(root, "samples", "a", "cdk.out", "asset.py"), "x = 1\n");
    const files = await scan(root);
    expect(files).toContain("samples/a/app.py");
    expect(files).not.toContain("samples/a/cdk.out/asset.py");
  });

  it("includes tracked and untracked (non-ignored) files", async () => {
    git(root, "add", "README.md");
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
    await fs.writeFile(path.join(root, "src", "untracked.ts"), "export {};\n");
    const files = await scan(root);
    expect(files).toContain("README.md");
    expect(files).toContain("src/untracked.ts");
  });

  it("still applies IGNORED_DIRS, dotfiles and binary extensions", async () => {
    await fs.mkdir(path.join(root, ".github"), { recursive: true });
    await fs.writeFile(path.join(root, ".github", "ci.yml"), "x: 1\n");
    await fs.writeFile(path.join(root, "logo.png"), "x");
    git(root, "add", "-f", "node_modules/junk.ts", ".github/ci.yml", "logo.png");
    const files = (await scan(root)).sort();
    expect(files).toEqual(["README.md", "src/db/client.ts", "src/index.ts"].sort());
  });

  it("scopes to the root when it is a subdirectory of the repository", async () => {
    await fs.writeFile(path.join(root, "top.ts"), "export {};\n");
    const files = await scan(path.join(root, "src"));
    expect(files.sort()).toEqual(["db/client.ts", "index.ts"]);
  });

  it("lists a tracked file that was deleted from the working tree", async () => {
    // The caller decides what to do with a path that no longer exists.
    git(root, "add", "README.md");
    await fs.rm(path.join(root, "README.md"));
    const files = await scan(root);
    expect(files).toContain("README.md");
  });
});
