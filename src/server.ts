/**
 * server.ts — MCP tool registration.
 *
 * Registers the memory tools on an McpServer. Phase 3 wires up read-only
 * tools: search_memory and get_memory. propose/deprecate/memory_for_path
 * follow in phases 4-5.
 *
 * Never writes to stdout — diagnostics go to stderr only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { entryTypeSchema } from "./schema.js";
import type { MemoryIndex } from "./search.js";

/** Wrap a JSON-serializable payload as a text content result. */
function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/** Wrap an error message as an error result (isError = true). */
function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export const SERVER_INFO = {
  name: "repomem",
  version: "0.1.0",
} as const;

/**
 * Register the read-only memory tools on the given server, backed by `index`.
 */
export function registerReadTools(server: McpServer, index: MemoryIndex): void {
  server.registerTool(
    "search_memory",
    {
      title: "Search memory",
      description:
        "Search the repository's memory for decisions, conventions, limitations and learnings. " +
        "Returns short summaries (id, type, title, status, snippet). Deprecated entries are " +
        "excluded by default. Use get_memory with an id to read the full entry.",
      inputSchema: {
        query: z.string().min(1).describe("Full-text query"),
        type: entryTypeSchema.optional().describe("Restrict to a single entry type"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Match entries having at least one of these tags (OR)"),
      },
    },
    async ({ query, type, tags }): Promise<CallToolResult> => {
      try {
        const hits = await index.search({ query, type, tags });
        return jsonResult({ count: hits.length, results: hits });
      } catch (err) {
        return errorResult(`search_memory failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_memory",
    {
      title: "Get memory entry",
      description:
        "Fetch the full content of a single memory entry by its id (file slug).",
      inputSchema: {
        id: z.string().min(1).describe("The entry id (file slug)"),
      },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const entry = await index.get(id);
        if (!entry) return errorResult(`No memory entry found with id "${id}".`);
        return jsonResult({
          id: entry.id,
          ...entry.frontmatter,
          body: entry.body,
        });
      } catch (err) {
        return errorResult(`get_memory failed: ${(err as Error).message}`);
      }
    },
  );
}
