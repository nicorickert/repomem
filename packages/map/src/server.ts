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
import type { MapIndex } from "./mapindex.js";
import { registerGenerationTools, registerQueryTools, type GraphSource } from "./tools.js";
import { MAP_INSTRUCTIONS } from "./instructions.js";

export const SERVER_INFO = {
  name: "repomem-map",
  version: "0.1.0",
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
