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

describe("Resolver (Python)", () => {
  let pyRoot: string;

  beforeEach(async () => {
    pyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-resolve-py-"));
    await fs.mkdir(path.join(pyRoot, "pkg", "sub"), { recursive: true });
    await fs.writeFile(path.join(pyRoot, "pkg", "__init__.py"), "");
    await fs.writeFile(path.join(pyRoot, "pkg", "mod.py"), "x = 1\n");
    await fs.writeFile(path.join(pyRoot, "pkg", "sub", "__init__.py"), "");
    await fs.writeFile(path.join(pyRoot, "pkg", "sub", "leaf.py"), "z = 3\n");
    await fs.writeFile(path.join(pyRoot, "main.py"), "y = 0\n");
  });

  afterEach(async () => {
    await fs.rm(pyRoot, { recursive: true, force: true });
  });

  it("resolves `from . import mod` to a sibling module", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("pkg/mod.py", ".")).toBe("pkg/__init__.py");
  });

  it("resolves `from .mod import x` to a sibling module", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("pkg/sub/leaf.py", "..mod")).toBe("pkg/mod.py");
  });

  it("resolves `from ..pkg import y` crossing up a package", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("pkg/sub/leaf.py", "..")).toBe("pkg/__init__.py");
  });

  it("resolves a relative submodule path `.sub.leaf`", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("pkg/mod.py", ".sub.leaf")).toBe("pkg/sub/leaf.py");
  });

  it("returns null for a relative import that does not resolve", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("pkg/mod.py", ".nope")).toBeNull();
  });

  it("resolves an absolute dot-path to a module inside the repo", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("main.py", "pkg.sub.leaf")).toBe("pkg/sub/leaf.py");
  });

  it("resolves an absolute dot-path to a package __init__.py", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("main.py", "pkg.sub")).toBe("pkg/sub/__init__.py");
  });

  it("resolves `from pkg.sub import leaf` via the source package", async () => {
    const r = await Resolver.create(pyRoot);
    // The parser normalizes this to the specifier "pkg.sub"; the imported name
    // `leaf` is not part of the specifier, so it resolves to the package.
    expect(r.resolve("main.py", "pkg.sub")).toBe("pkg/sub/__init__.py");
  });

  it("returns null for stdlib and third-party absolute imports", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("main.py", "os")).toBeNull();
    expect(r.resolve("main.py", "numpy")).toBeNull();
  });

  it("returns null for an absolute dot-path that does not exist in the repo", async () => {
    const r = await Resolver.create(pyRoot);
    expect(r.resolve("main.py", "pkg.missing")).toBeNull();
  });
});

describe("Resolver (Python source roots)", () => {
  let srcRoot: string;

  // Layout: a package nested under backend/ (marked by pyproject.toml), with
  // imports written as "src.*" — resolvable only via the backend/ source root.
  beforeEach(async () => {
    srcRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repomem-map-resolve-srcroot-"));
    await fs.mkdir(path.join(srcRoot, "backend", "src", "domain", "model"), { recursive: true });
    await fs.writeFile(path.join(srcRoot, "backend", "pyproject.toml"), "[project]\nname='x'\n");
    await fs.writeFile(
      path.join(srcRoot, "backend", "src", "domain", "model", "checklist.py"),
      "class CreditFileConditions: pass\n",
    );
    await fs.writeFile(
      path.join(srcRoot, "backend", "src", "domain", "model", "credit_file.py"),
      "from src.domain.model.checklist import CreditFileConditions\n",
    );
  });

  afterEach(async () => {
    await fs.rm(srcRoot, { recursive: true, force: true });
  });

  it("resolves an absolute `src.*` import via a nested source root", async () => {
    const r = await Resolver.create(srcRoot);
    expect(
      r.resolve("backend/src/domain/model/credit_file.py", "src.domain.model.checklist"),
    ).toBe("backend/src/domain/model/checklist.py");
  });

  it("still resolves absolute dot-paths that match from the repo root", async () => {
    // A dot-path that exists directly under the root must keep resolving even
    // when nested source roots are present.
    await fs.mkdir(path.join(srcRoot, "topmod"), { recursive: true });
    await fs.writeFile(path.join(srcRoot, "topmod", "__init__.py"), "");
    const r = await Resolver.create(srcRoot);
    expect(r.resolve("backend/src/domain/model/credit_file.py", "topmod")).toBe(
      "topmod/__init__.py",
    );
  });

  it("returns null for a stdlib import even with source roots present", async () => {
    const r = await Resolver.create(srcRoot);
    expect(r.resolve("backend/src/domain/model/credit_file.py", "os")).toBeNull();
  });
});
