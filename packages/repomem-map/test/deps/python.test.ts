import { describe, it, expect } from "vitest";
import { parsePython } from "../../src/deps/python.js";

describe("parsePython — imports", () => {
  it("extracts plain and dotted absolute imports", () => {
    const src = ["import a", "import a.b.c"].join("\n");
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual(["a", "a.b.c"]);
  });

  it("handles `import x as y` by recording the module, not the alias", () => {
    const { imports } = parsePython("import a.b as c\n", "m.py");
    expect(imports).toEqual(["a.b"]);
  });

  it("splits `import a, b.c` into one specifier per module", () => {
    const { imports } = parsePython("import a, b.c\n", "m.py");
    expect(imports).toEqual(["a", "b.c"]);
  });

  it("records the source package for `from X import ...`", () => {
    const src = [
      "from pkg import x",
      "from pkg.sub import a, b as c",
    ].join("\n");
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual(["pkg", "pkg.sub"]);
  });

  it("preserves leading dots for relative imports", () => {
    const src = [
      "from . import c",
      "from .mod import x",
      "from ..pkg.sub import y",
    ].join("\n");
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual([".", ".mod", "..pkg.sub"]);
  });

  it("joins parenthesized multi-line from-imports", () => {
    const src = ["from x import (", "  a,", "  b,", "  c,", ")"].join("\n");
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual(["x"]);
  });

  it("joins backslash line continuations", () => {
    const src = "import a, \\\n    b\n";
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual(["a", "b"]);
  });

  it("ignores imports inside comments", () => {
    const src = ["# import a", "x = 1  # from b import c"].join("\n");
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual([]);
  });

  it("ignores import-like text inside strings", () => {
    const src = ['s = "import a"', "t = 'from b import c'"].join("\n");
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual([]);
  });

  it("ignores import-like text inside triple-quoted strings", () => {
    const src = ['"""', "import a", "from b import c", '"""', "import real"].join("\n");
    const { imports } = parsePython(src, "m.py");
    expect(imports).toEqual(["real"]);
  });
});

describe("parsePython — exports", () => {
  it("counts the entries of __all__ when declared", () => {
    const src = [
      '__all__ = ["a", "b", "c"]',
      "def a(): pass",
      "def b(): pass",
      "def _hidden(): pass",
    ].join("\n");
    const { exports } = parsePython(src, "m.py");
    expect(exports).toBe(3);
  });

  it("counts a parenthesized multi-line __all__", () => {
    const src = ["__all__ = (", '  "x",', '  "y",', ")"].join("\n");
    const { exports } = parsePython(src, "m.py");
    expect(exports).toBe(2);
  });

  it("falls back to public top-level symbols when no __all__", () => {
    const src = [
      "import os",
      "def foo(): pass",
      "def _priv(): pass",
      "class Bar:",
      "    def method(self): pass",
      "class _Hidden: pass",
      "CONST = 1",
      "_private = 2",
      "x, y = 1, 2",
    ].join("\n");
    const { exports } = parsePython(src, "m.py");
    // foo, Bar, CONST = 3 public top-level symbols.
    expect(exports).toBe(3);
  });

  it("ignores nested defs and class methods in the fallback", () => {
    const src = [
      "def outer():",
      "    def inner(): pass",
      "    return inner",
      "class C:",
      "    attr = 1",
      "    def m(self): pass",
    ].join("\n");
    const { exports } = parsePython(src, "m.py");
    // outer, C = 2.
    expect(exports).toBe(2);
  });
});
