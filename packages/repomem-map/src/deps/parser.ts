/**
 * parser.ts — per-language extraction of import/export information.
 *
 * A `LanguageParser` turns a file's text into the raw module specifiers it
 * imports (unresolved) and a count of the symbols it exports. Specifiers are
 * returned verbatim (e.g. "./a", "@/c", "react"); resolving them to repo paths
 * is the job of resolve.ts.
 *
 * This iteration ships a TS/JS parser built on the TypeScript compiler AST.
 * The registry is keyed by extension so other languages (e.g. Python) can be
 * added later without touching callers.
 */

import path from "node:path";
import ts from "typescript";

/** What a parser extracts from one source file. */
export interface ParseResult {
  /** Raw, unresolved module specifiers this file imports. */
  imports: string[];
  /** Number of exported symbols declared in this file. */
  exports: number;
}

/** A language-specific extractor selected by file extension. */
export interface LanguageParser {
  /** Lowercase extensions (with dot) this parser handles. */
  readonly extensions: readonly string[];
  /** Extract imports/exports from file content. */
  parse(content: string, filePath: string): ParseResult;
}

const TS_JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

/** Collect raw specifiers and count exports from a TS/JS source string. */
function parseTsJs(content: string, filePath: string): ParseResult {
  const scriptKind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    scriptKind,
  );

  const imports: string[] = [];
  let exports = 0;

  const addSpecifier = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) imports.push(node.text);
  };

  const hasExportModifier = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);

  const visit = (node: ts.Node): void => {
    // import ... from "x";  and  import "x";
    if (ts.isImportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier);
    }
    // export ... from "x";  and  export * from "x";
    else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) addSpecifier(node.moduleSpecifier);
      // `export { a } from "x"` / `export { a }` — count the named exports.
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        exports += node.exportClause.elements.length;
      }
    }
    // import x = require("x");
    else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        addSpecifier(node.moduleReference.expression);
      }
    }
    // dynamic import("x")
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpecifier(node.arguments[0]);
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1
      ) {
        addSpecifier(node.arguments[0]);
      }
    }

    // Exports: declarations carrying the `export` modifier.
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      hasExportModifier(node)
    ) {
      exports += 1; // named or anonymous (default) still one symbol
    } else if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      exports += node.declarationList.declarations.length;
    } else if (ts.isExportAssignment(node)) {
      // export default <expr>;  or  export = <expr>;
      exports += 1;
    }

    ts.forEachChild(node, visit);
  };

  // Count `export default function/class` which carry both export+default mods.
  ts.forEachChild(sf, visit);

  return { imports, exports };
}

const tsJsParser: LanguageParser = {
  extensions: TS_JS_EXTENSIONS,
  parse: parseTsJs,
};

/** All registered parsers. New languages append here. */
const PARSERS: readonly LanguageParser[] = [tsJsParser];

/** Every extension handled by some registered parser. */
export const SUPPORTED_EXTENSIONS: readonly string[] = PARSERS.flatMap(
  (p) => p.extensions,
);

/** The parser for a file path, or null when the extension is unsupported. */
export function parserFor(filePath: string): LanguageParser | null {
  const ext = path.extname(filePath).toLowerCase();
  return PARSERS.find((p) => p.extensions.includes(ext)) ?? null;
}

/** Parse a source file, or return empty result when unsupported. */
export function parseSource(filePath: string, content: string): ParseResult {
  const parser = parserFor(filePath);
  if (!parser) return { imports: [], exports: 0 };
  return parser.parse(content, filePath);
}
