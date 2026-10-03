import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Resolver } from "../../src/deps/resolve.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-resolve-"));
  await fs.mkdir(path.join(root, "src", "b"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "x"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "c"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(root, "src", "b", "index.ts"), "export const b = 2;\n");
  await fs.writeFile(path.join(root, "src", "x", "index.ts"), "export const x = 3;\n");
  await fs.writeFile(path.join(root, "src", "c", "foo.ts"), "export const foo = 4;\n");
  await fs.writeFile(path.join(root, "src", "main.ts"), "export const m = 0;\n");
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    }),
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("Resolver", () => {
  it("resolves a relative import with implicit extension", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/main.ts", "./a")).toBe("src/a.ts");
  });

  it("resolves a relative import to an index file", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/main.ts", "./b")).toBe("src/b/index.ts");
  });

  it("resolves a parent-relative import ending in /index", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/c/foo.ts", "../x/index")).toBe("src/x/index.ts");
  });

  it("resolves a tsconfig path alias", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/main.ts", "@/a")).toBe("src/a.ts");
    expect(r.resolve("src/main.ts", "@/b")).toBe("src/b/index.ts");
  });

  it("returns null for node builtins", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/main.ts", "node:fs")).toBeNull();
    expect(r.resolve("src/main.ts", "fs")).toBeNull();
  });

  it("returns null for npm packages", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/main.ts", "express")).toBeNull();
    expect(r.resolve("src/main.ts", "@scope/pkg")).toBeNull();
  });

  it("returns null for a relative import that does not resolve to a real file", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/main.ts", "./does-not-exist")).toBeNull();
  });

  it("resolves imports written with an explicit .js extension to the .ts source", async () => {
    const r = await Resolver.create(root);
    expect(r.resolve("src/main.ts", "./a.js")).toBe("src/a.ts");
  });
});
