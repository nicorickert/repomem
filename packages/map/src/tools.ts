/**
 * tools.ts — MCP tools for repomem-map.
 *
 * Generation (in-agent) tools:
 *   - request_summaries: returns pending files + the prompt + a per-run cap.
 *   - save_summary:      validates the hash and persists one summary.
 *
 * The map never calls an LLM: the invoking agent reads files and writes the
 * summaries, mirroring the core's "agent drafts / tool persists" pattern.
 *
 * Query tools (find_code, get_module) are registered in a later step and reuse
 * the result helpers below.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { pending } from "./pending.js";
import { loadPrompt } from "./prompt.js";
import { hashContent, writeSummary, readSummary, type SummaryRecord } from "./summary.js";
import { isStale, type MapIndex } from "./mapindex.js";
import type { DepGraph, ImpactDirection } from "./deps/graph.js";
import { launchViewer } from "./web/launch.js";

/** Default maximum files returned by request_summaries in one run. */
export const DEFAULT_CAP = 20;

/**
 * Serialize a tool payload. Isolated so the wire format can change later
 * (e.g. a more token-efficient format) without touching the tools.
 */
export function formatResult(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: formatResult(payload) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Register the in-agent generation tools against a repo `root`. */
export function registerGenerationTools(server: McpServer, root: string): void {
  server.registerTool(
    "request_summaries",
    {
      title: "Request pending summaries",
      description:
        "List source files that need a summary (missing or stale) together with " +
        "the summarization prompt and a per-run cap. The agent should read each " +
        "file, write a summary following the prompt, and call save_summary. " +
        "Repeat until no files are pending.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max files to return this run (defaults to 20)"),
      },
    },
    async ({ limit }): Promise<CallToolResult> => {
      try {
        const cap = limit ?? DEFAULT_CAP;
        const all = await pending(root);
        const prompt = await loadPrompt();
        return jsonResult({ pending: all.slice(0, cap), prompt, cap });
      } catch (err) {
        return errorResult(`request_summaries failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "save_summary",
    {
      title: "Save a file summary",
      description:
        "Persist a summary for one source file. The hash MUST be the hash " +
        "returned by request_summaries for that file; it is re-validated against " +
        "the file's current content and rejected if it no longer matches.",
      inputSchema: {
        path: z.string().min(1).describe("Repository-relative file path"),
        summary: z.string().min(1).describe("The summary text"),
        search_terms: z.array(z.string()).describe("Retrieval keywords"),
        hash: z.string().min(1).describe("Hash from request_summaries for this file"),
        model: z
          .string()
          .optional()
          .describe('Model that produced the summary (defaults to "agent")'),
      },
    },
    async ({ path: p, summary, search_terms, hash, model }): Promise<CallToolResult> => {
      try {
        let content: string;
        try {
          content = await fs.readFile(path.join(root, p), "utf8");
        } catch {
          return errorResult(`save_summary failed: file not found: ${p}`);
        }
        const current = hashContent(content);
        if (current !== hash) {
          return errorResult(
            `save_summary rejected: hash does not match current content of ${p}. ` +
              `Re-run request_summaries to get the current hash.`,
          );
        }
        const record: SummaryRecord = {
          hash,
          summary,
          search_terms,
          model: model ?? "agent",
          generated_at: new Date().toISOString(),
        };
        await writeSummary(root, p, record);
        return jsonResult({ status: "saved", path: p });
      } catch (err) {
        return errorResult(`save_summary failed: ${(err as Error).message}`);
      }
    },
  );
}

/** Register the read-only query tools backed by an in-memory `index`.
 *
 * The dependency tools (`get_dependencies`, `get_dependents`) and the edge
 * fields of `get_module` are driven entirely by the import graph and work
 * even when no summaries have been generated — summary generation is optional.
 */
export function registerQueryTools(
  server: McpServer,
  index: MapIndex,
  root: string,
  graph?: DepGraph,
): void {
  server.registerTool(
    "find_code",
    {
      title: "Find code",
      description:
        "Search the map for files whose summary, search terms or path match a " +
        "query. Returns compact hits (path, summary, score). Use get_module for " +
        "the full record of a specific path.",
      inputSchema: {
        query: z.string().min(1).describe("What to look for"),
      },
    },
    async ({ query }): Promise<CallToolResult> => {
      try {
        const hits = index.search(query);
        return jsonResult({ count: hits.length, results: hits });
      } catch (err) {
        return errorResult(`find_code failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_module",
    {
      title: "Get module",
      description:
        "Return the map summary for a specific repository-relative path, with a " +
        "`stale` flag set when the file content has changed since the summary was " +
        "generated. Returns found:false when there is no summary for the path.",
      inputSchema: {
        path: z.string().min(1).describe("Repository-relative file path"),
      },
    },
    async ({ path: p }): Promise<CallToolResult> => {
      try {
        const record = index.get(p) ?? (await readSummary(root, p));
        const dependencies = graph?.dependencies(p) ?? [];
        const dependents = graph?.dependents(p) ?? [];
        if (!record) {
          // No summary, but the file may still be a graph node with edges.
          const known = graph?.has(p) ?? false;
          return jsonResult({ found: false, path: p, known, dependencies, dependents });
        }
        let stale = false;
        try {
          const content = await fs.readFile(path.join(root, p), "utf8");
          stale = isStale(record, content);
        } catch {
          // File is gone; treat the summary as stale.
          stale = true;
        }
        return jsonResult({
          found: true,
          path: p,
          summary: record.summary,
          search_terms: record.search_terms,
          model: record.model,
          generated_at: record.generated_at,
          stale,
          dependencies,
          dependents,
        });
      } catch (err) {
        return errorResult(`get_module failed: ${(err as Error).message}`);
      }
    },
  );

  // Dependency / blast-radius tools. Registered only when a graph is provided.
  if (!graph) return;
  const g = graph;

  const impactTool = (
    name: string,
    direction: ImpactDirection,
    title: string,
    description: string,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          path: z.string().min(1).describe("Repository-relative file path"),
          depth: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Max hops from the file (1 = direct). Omit for the full transitive closure."),
        },
      },
      async ({ path: p, depth }): Promise<CallToolResult> => {
        try {
          if (!g.has(p)) {
            return jsonResult({ found: false, path: p });
          }
          const results = g.impact(p, { direction, depth });
          return jsonResult({ found: true, path: p, count: results.length, results });
        } catch (err) {
          return errorResult(`${name} failed: ${(err as Error).message}`);
        }
      },
    );
  };

  impactTool(
    "get_dependents",
    "dependents",
    "Get dependents (blast radius)",
    "List the files that depend on a given file — the blast radius of changing " +
      "it — with each node's hop distance. Transitive by default; pass depth to " +
      "limit hops (depth:1 = direct dependents). Derived from the import graph; " +
      "works without any summaries.",
  );

  impactTool(
    "get_dependencies",
    "dependencies",
    "Get dependencies",
    "List the files a given file depends on (what it imports, transitively) with " +
      "each node's hop distance. Transitive by default; pass depth to limit hops " +
      "(depth:1 = direct dependencies). Derived from the import graph; works " +
      "without any summaries.",
  );

  server.registerTool(
    "open_graph",
    {
      title: "Open the dependency graph viewer",
      description:
        "Start a local web viewer for the dependency graph and return its URL. " +
        "The viewer renders an interactive force-directed graph to inspect " +
        "dependencies, blast radius, cycles and hubs at a glance. Derived from " +
        "the import graph; works without any summaries (summaries, when present, " +
        "are shown in the side panel).",
      inputSchema: {
        port: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Port to bind (0 picks a free port). Defaults to 7700."),
      },
    },
    async ({ port }): Promise<CallToolResult> => {
      try {
        const handle = await launchViewer({ root, graph: g, index, port, openBrowser: true });
        return jsonResult({ status: "started", url: handle.url, port: handle.port });
      } catch (err) {
        return errorResult(`open_graph failed: ${(err as Error).message}`);
      }
    },
  );
}
