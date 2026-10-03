import { describe, it, expect } from "vitest";
import { parseSource, parserFor, SUPPORTED_EXTENSIONS } from "../../src/deps/parser.js";

describe("parserFor", () => {
  it("selects a parser for TS/JS extensions", () => {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(parserFor(`file${ext}`)).not.toBeNull();
    }
  });

  it("returns null for unsupported extensions", () => {
    expect(parserFor("file.py")).toBeNull();
    expect(parserFor("README.md")).toBeNull();
  });

  it("exposes the supported extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".ts");
    expect(SUPPORTED_EXTENSIONS).toContain(".tsx");
  });
});

describe("parseSource (TS/JS)", () => {
  it("extracts static import specifiers", () => {
    const src = [
      `import a from "./a";`,
      `import { b } from "../b/index";`,
      `import * as c from "@/c";`,
      `import "./side-effect";`,
    ].join("\n");
    const { imports } = parseSource("f.ts", src);
    expect(imports).toEqual(["./a", "../b/index", "@/c", "./side-effect"]);
  });

  it("extracts export...from specifiers", () => {
    const src = [`export { x } from "./x";`, `export * from "./y";`].join("\n");
    const { imports } = parseSource("f.ts", src);
    expect(imports).toContain("./x");
    expect(imports).toContain("./y");
  });

  it("extracts dynamic import() and require() specifiers", () => {
    const src = [
      `const m = await import("./dyn");`,
      `const r = require("../req");`,
    ].join("\n");
    const { imports } = parseSource("f.ts", src);
    expect(imports).toContain("./dyn");
    expect(imports).toContain("../req");
  });

  it("ignores string literals that are not imports", () => {
    const src = [`const s = "./not-an-import";`, `console.log("hello");`].join("\n");
    const { imports } = parseSource("f.ts", src);
    expect(imports).toEqual([]);
  });

  it("counts declared exports", () => {
    const src = [
      `export const a = 1;`,
      `export function b() {}`,
      `export class C {}`,
      `export default function () {}`,
      `const d = 2;`,
      `export { d };`,
    ].join("\n");
    const { exports } = parseSource("f.ts", src);
    // a, b, C, default, and the { d } re-export = 5
    expect(exports).toBeGreaterThanOrEqual(5);
  });

  it("parses TSX syntax without throwing", () => {
    const src = [`import React from "react";`, `export const El = () => <div/>;`].join("\n");
    const { imports, exports } = parseSource("f.tsx", src);
    expect(imports).toContain("react");
    expect(exports).toBeGreaterThanOrEqual(1);
  });
});
