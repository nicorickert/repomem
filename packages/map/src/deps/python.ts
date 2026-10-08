/**
 * python.ts — extract import specifiers and export counts from Python source.
 *
 * A lightweight, dependency-free scanner that turns raw text into "logical
 * lines" (joining backslash continuations and open-parenthesis groups while
 * stripping comments and string literals, including triple-quoted ones), then
 * reads `import`/`from` statements off those lines.
 *
 * Specifiers are normalized so the resolver can act on them unambiguously:
 *   - absolute imports become dot-paths:            "pkg.sub.mod"
 *   - relative imports keep their leading dots:     ".", ".mod", "..pkg.sub"
 * For `from X import ...` the specifier is the source package `X` (never the
 * imported names). Resolving specifiers to repo paths is the job of resolve.ts.
 */

import type { ParseResult } from "./parser.js";

/** A logical line with the indentation of its first physical line. */
interface LogicalLine {
  /** Code text with comments and string literals removed. */
  text: string;
  /** Leading-space count of the first physical line (0 = module top-level). */
  indent: number;
}

/**
 * Scan source into logical lines, removing comments and string contents.
 *
 * String bodies are replaced by an empty `""` placeholder token so import-like
 * text inside them is never seen, while the number of string literals (e.g. the
 * entries of `__all__`) stays countable. Triple-quoted strings and both
 * single/double quotes are handled; backslash continuations and unclosed
 * brackets fold the next physical line into the current logical line.
 */
function toLogicalLines(content: string): LogicalLine[] {
  const lines: LogicalLine[] = [];

  let buf = "";
  let bufIndent = 0;
  let bufStarted = false;

  // Cross-line state.
  let inTriple: '"""' | "'''" | null = null;
  let depth = 0; // net open ( [ {
  let continued = false; // previous physical line ended with backslash

  const physical = content.split(/\r?\n/);

  for (const raw of physical) {
    const indent = raw.length - raw.replace(/^[ \t]*/, "").length;

    let i = 0;
    let out = "";
    let inStr: '"' | "'" | null = null;

    while (i < raw.length) {
      const two = raw.slice(i, i + 3);

      if (inTriple) {
        if (two === inTriple) {
          inTriple = null;
          i += 3;
          out += '""'; // placeholder: a (triple-quoted) string literal was here
        } else {
          i += 1;
        }
        continue;
      }

      if (inStr) {
        if (raw[i] === "\\") {
          i += 2; // skip escaped char inside string
          continue;
        }
        if (raw[i] === inStr) {
          inStr = null;
          out += '""'; // placeholder: a string literal was here
        }
        i += 1;
        continue;
      }

      // Not currently inside any string.
      if (two === '"""' || two === "'''") {
        inTriple = two as '"""' | "'''";
        i += 3;
        continue;
      }
      const ch = raw[i]!;
      if (ch === "#") break; // comment to end of line
      if (ch === '"' || ch === "'") {
        inStr = ch;
        i += 1;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      out += ch;
      i += 1;
    }

    // Decide whether this physical line starts a new logical line.
    if (!bufStarted) {
      bufStarted = true;
      bufIndent = indent;
    }

    buf += (buf.length > 0 ? " " : "") + out.trim();

    // A trailing backslash (outside strings) continues the next line.
    continued = /\\\s*$/.test(raw) && !inTriple && !inStr;
    if (continued) {
      buf = buf.replace(/\\\s*$/, "").trimEnd();
    }

    const stillOpen = inTriple !== null || depth > 0 || continued;
    if (!stillOpen) {
      lines.push({ text: buf.trim(), indent: bufIndent });
      buf = "";
      bufStarted = false;
      bufIndent = 0;
    }
  }

  if (bufStarted && buf.trim().length > 0) {
    lines.push({ text: buf.trim(), indent: bufIndent });
  }

  return lines;
}

/** Extract normalized import specifiers from one logical line of code. */
function importsFromLine(text: string): string[] {
  // from <module> import ...
  const from = /^from\s+(\.*[\w.]*)\s+import\s+/.exec(text);
  if (from) {
    const mod = from[1]!;
    return mod.length > 0 ? [mod] : [];
  }

  // import a, b.c as d, e
  const imp = /^import\s+(.+)$/.exec(text);
  if (imp) {
    return imp[1]!
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0]!.trim())
      .filter((m) => m.length > 0);
  }

  return [];
}

/** Count the string-literal entries declared in an `__all__` logical line. */
function countAllEntries(text: string): number | null {
  // __all__ = [...]  or  __all__ = (...)  or  __all__ += [...]
  if (!/^__all__\s*(?::[^=]+)?(?:\+?=)/.test(text)) return null;
  // String literals were replaced by the `""` placeholder during scanning.
  const matches = text.match(/""/g);
  return matches ? matches.length : 0;
}

/** True when a top-level logical line declares a public symbol. */
function publicTopLevelSymbols(text: string): number {
  // def name(...)  /  async def name(...)  /  class Name
  const def = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(text);
  if (def) return def[1]!.startsWith("_") ? 0 : 1;
  const cls = /^class\s+([A-Za-z_]\w*)/.exec(text);
  if (cls) return cls[1]!.startsWith("_") ? 0 : 1;

  // Module-level assignments: `name = ...`, `name: T = ...`, `a = b = ...`.
  // Tuple targets (`x, y = ...`) are ignored to keep the heuristic simple.
  const assign = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(text);
  if (assign) {
    const name = assign[1]!;
    if (name === "__all__") return 0;
    return name.startsWith("_") ? 0 : 1;
  }
  return 0;
}

/** Count exports: entries of `__all__` if present, else public top-level symbols. */
function countExports(lines: LogicalLine[]): number {
  let fromAll = 0;
  let hasAll = false;
  for (const { text, indent } of lines) {
    if (indent !== 0) continue;
    const all = countAllEntries(text);
    if (all !== null) {
      fromAll += all;
      hasAll = true;
    }
  }
  if (hasAll) return fromAll;

  let count = 0;
  for (const { text, indent } of lines) {
    if (indent !== 0) continue;
    count += publicTopLevelSymbols(text);
  }
  return count;
}

/** Parse Python source into import specifiers and an export count. */
export function parsePython(content: string, _filePath: string): ParseResult {
  const lines = toLogicalLines(content);
  const imports: string[] = [];
  for (const { text } of lines) {
    for (const spec of importsFromLine(text)) imports.push(spec);
  }
  return { imports, exports: countExports(lines) };
}
