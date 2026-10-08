/**
 * server.ts — MCP tool registration.
 *
 * Registers the memory tools on an McpServer:
 *  - read-only:  search_memory, get_memory
 *  - query:      memory_for_path
 *  - write:      propose_memory (draft only), deprecate_memory
 *
 * Never writes to stdout — diagnostics go to stderr only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { entryTypeSchema, type MemoryEntry } from "./schema.js";
import type { MemoryIndex } from "./search.js";
import {
  proposeEntry,
  deprecateEntry,
  entriesForPath,
} from "./store.js";

function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/** Compact summary used by memory_for_path (small, like search hits). */
function summarize(entry: MemoryEntry) {
  return {
    id: entry.id,
    type: entry.frontmatter.type,
    title: entry.frontmatter.title,
    status: entry.frontmatter.status,
  };
}

export const SERVER_INFO = {
  name: "repomem",
  version: "0.1.0",
} as const;

/** Register the read-only memory tools, backed by `index`. */
export function registerReadTools(server: McpServer, index: MemoryIndex): void {
  server.registerTool(
    "search_memory",
    {
      title: "Search memory",
      description:
        "Search the repository's memory for decisions, conventions, limitations, learnings and context. " +
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
        return jsonResult({ id: entry.id, ...entry.frontmatter, body: entry.body });
      } catch (err) {
        return errorResult(`get_memory failed: ${(err as Error).message}`);
      }
    },
  );
}

/**
 * Register the query + write tools. These operate against the memory `root`
 * on disk; the shared `index` is used for path matching reads.
 */
export function registerWriteTools(
  server: McpServer,
  root: string,
  index: MemoryIndex,
): void {
  server.registerTool(
    "memory_for_path",
    {
      title: "Memory for a path",
      description:
        "Return memory entries whose related_paths globs match the given file path. " +
        "Accepted entries are prioritized over drafts; deprecated entries are excluded.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("A repository-relative file path, e.g. src/db/index.ts"),
      },
    },
    async ({ path: p }): Promise<CallToolResult> => {
      try {
        // Make sure any on-disk changes are reflected.
        await index.refreshIfChanged();
        const entries = await entriesForPath(root, p);
        return jsonResult({
          count: entries.length,
          results: entries.map(summarize),
        });
      } catch (err) {
        return errorResult(`memory_for_path failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "propose_memory",
    {
      title: "Propose a memory entry",
      description:
        "Propose a new memory entry. It is ALWAYS created as a draft for a human to review " +
        "and accept in a pull request. Rejects duplicates (a title whose id already exists " +
        "for that type). Never overwrites existing entries.",
      inputSchema: {
        type: entryTypeSchema.describe("decision | convention | limitation | learning | context"),
        title: z.string().min(1).describe("A concise, human-readable title"),
        body: z.string().min(1).describe("The markdown body of the entry"),
        tags: z.array(z.string()).optional().describe("Freeform tags"),
        related_paths: z
          .array(z.string())
          .optional()
          .describe("Globs of files/areas this entry relates to"),
        supersedes: z
          .string()
          .optional()
          .describe("Id of an entry this one is intended to replace"),
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await proposeEntry(root, args);
        await index.refreshIfChanged();
        return jsonResult({
          status: "draft",
          id: result.id,
          path: result.path,
          message:
            "Created as a draft. A human should review and accept it in a pull request.",
        });
      } catch (err) {
        return errorResult(`propose_memory failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "deprecate_memory",
    {
      title: "Deprecate a memory entry",
      description:
        "Mark an existing memory entry as deprecated, recording the reason (and optionally " +
        "the id of the entry that supersedes it).",
      inputSchema: {
        id: z.string().min(1).describe("The id of the entry to deprecate"),
        reason: z.string().min(1).describe("Why the entry is being deprecated"),
        superseded_by: z
          .string()
          .optional()
          .describe("Id of the entry that replaces this one, if any"),
      },
    },
    async ({ id, reason, superseded_by }): Promise<CallToolResult> => {
      try {
        const result = await deprecateEntry(root, id, reason, superseded_by);
        await index.refreshIfChanged();
        return jsonResult({
          status: "deprecated",
          id: result.id,
          path: result.path,
        });
      } catch (err) {
        return errorResult(`deprecate_memory failed: ${(err as Error).message}`);
      }
    },
  );
}

/** Register every tool on the server. */
export function registerAllTools(
  server: McpServer,
  root: string,
  index: MemoryIndex,
): void {
  registerReadTools(server, index);
  registerWriteTools(server, root, index);
}
