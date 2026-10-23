/**
 * server.ts — MCP tool registration for repomem-map.
 *
 * Registers the four MVP tools:
 *   - generation (in-agent): request_summaries, save_summary
 *   - query:                 find_code, get_module
 *
 * Diagnostics go to stderr only; stdout is reserved for the MCP protocol.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import type { MapIndex } from "./mapindex.js";
import { registerGenerationTools, registerQueryTools, type GraphSource } from "./tools.js";
import { MAP_INSTRUCTIONS } from "./instructions.js";

/**
 * Version of this package, read from its `package.json` so the version a client
 * sees on `initialize` is the one actually running. `src/` and `dist/` both sit
 * one level below the package root. Falls back to "unknown" rather than failing
 * the server if the file cannot be read.
 */
function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const { version } = JSON.parse(raw) as { version?: unknown };
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

export const SERVER_INFO = {
  name: "repomem-map",
  version: packageVersion(),
} as const;

/**
 * Options for `new McpServer(SERVER_INFO, SERVER_OPTIONS)`. `instructions` is
 * delivered on `initialize` so any MCP client can put the protocol in the
 * model's context without loading skills, hooks or a custom agent.
 */
export const SERVER_OPTIONS = {
  instructions: MAP_INSTRUCTIONS,
} as const;

/** Register every map tool on the server. */
export function registerAllTools(
  server: McpServer,
  root: string,
  index: MapIndex,
  graph?: GraphSource,
): void {
  registerGenerationTools(server, root, index);
  registerQueryTools(server, index, root, graph);
}
