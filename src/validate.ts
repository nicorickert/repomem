/**
 * validate.ts — pure validation logic for `repomem validate`.
 *
 * Checks performed:
 *  1. Every `.md` entry under the memory root has valid frontmatter.
 *  2. Every `supersedes` reference points at an existing entry id.
 *  3. No obvious secrets (API keys, tokens, private keys) appear in any entry.
 *
 * This module is I/O-light and returns a structured report; the CLI decides
 * the process exit code. Nothing here writes to stdout.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  frontmatterSchema,
  TYPE_DIRS,
  ENTRY_TYPES,
  type EntryType,
} from "./schema.js";

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  file: string;
  line?: number;
  rule: string;
  message: string;
}

export interface ValidateReport {
  findings: Finding[];
  checked: number;
  ok: boolean;
}

/**
 * High-confidence secret patterns. Tuned to minimize false positives; this is
 * a safety net, not a replacement for a dedicated secret scanner.
 */
export const SECRET_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { rule: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: "google-api-key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { rule: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  {
    rule: "generic-secret-assignment",
    // key-like name = long opaque value (>= 16 chars, no spaces)
    re: /\b(?:api[_-]?key|secret|token|passwd|password|access[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9+/_\-]{16,}["']?/i,
  },
];

/** Scan a block of text for secrets, returning one finding per match line. */
export function scanSecrets(text: string, file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, idx) => {
    for (const { rule, re } of SECRET_PATTERNS) {
      if (re.test(lineText)) {
        findings.push({
          severity: "error",
          file,
          line: idx + 1,
          rule: `secret:${rule}`,
          message: `possible secret detected (${rule})`,
        });
      }
    }
  });
  return findings;
}

interface RawEntry {
  file: string;
  id: string;
  type: EntryType;
  data: unknown;
  raw: string;
}

/** Collect every .md file under the memory root, grouped by its folder type. */
async function collectFiles(root: string): Promise<Array<{ file: string; type: EntryType }>> {
  const out: Array<{ file: string; type: EntryType }> = [];
  for (const type of ENTRY_TYPES) {
    const dir = path.join(root, TYPE_DIRS[type]);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".md")) out.push({ file: path.join(dir, name), type });
    }
  }
  return out;
}

/**
 * Validate every entry under `root`. Returns a structured report. `ok` is true
 * only when there are no error-severity findings.
 */
export async function validateRoot(root: string): Promise<ValidateReport> {
  const findings: Finding[] = [];
  const files = await collectFiles(root);
  const validEntries: RawEntry[] = [];
  const knownIds = new Set<string>();

  for (const { file, type } of files) {
    const id = path.basename(file, ".md");
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      findings.push({
        severity: "error",
        file,
        rule: "io",
        message: `could not read file: ${(err as Error).message}`,
      });
      continue;
    }

    // Secret scan runs over the whole file regardless of frontmatter validity.
    findings.push(...scanSecrets(raw, file));

    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(raw);
    } catch (err) {
      findings.push({
        severity: "error",
        file,
        rule: "frontmatter",
        message: `unparseable frontmatter: ${(err as Error).message}`,
      });
      continue;
    }

    const result = frontmatterSchema.safeParse(parsed.data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        findings.push({
          severity: "error",
          file,
          rule: "frontmatter",
          message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        });
      }
      continue;
    }

    if (result.data.type !== type) {
      findings.push({
        severity: "error",
        file,
        rule: "type-folder-mismatch",
        message: `declared type "${result.data.type}" does not match folder "${TYPE_DIRS[type]}"`,
      });
      continue;
    }

    knownIds.add(id);
    validEntries.push({ file, id, type, data: result.data, raw });
  }

  // supersedes references must resolve to a known id.
  for (const entry of validEntries) {
    const supersedes = (entry.data as { supersedes?: string }).supersedes;
    if (supersedes && !knownIds.has(supersedes)) {
      findings.push({
        severity: "error",
        file: entry.file,
        rule: "dangling-supersedes",
        message: `supersedes "${supersedes}" does not match any existing entry id`,
      });
    }
  }

  const ok = !findings.some((f) => f.severity === "error");
  return { findings, checked: files.length, ok };
}

/** Format a report as human-readable lines (for stderr/stdout in the CLI). */
export function formatReport(report: ValidateReport, root: string): string {
  const lines: string[] = [];
  lines.push(`Validated ${report.checked} entr${report.checked === 1 ? "y" : "ies"} under ${root}`);
  if (report.findings.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }
  for (const f of report.findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    lines.push(`  [${f.severity}] ${where} (${f.rule}): ${f.message}`);
  }
  const errors = report.findings.filter((f) => f.severity === "error").length;
  lines.push(`${errors} error(s), ${report.findings.length - errors} warning(s).`);
  return lines.join("\n");
}
