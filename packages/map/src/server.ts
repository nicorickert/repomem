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
import type { DepGraph } from "./deps/graph.js";
import { registerGenerationTools, registerQueryTools } from "./tools.js";

export const SERVER_INFO = {
  name: "repomem-map",
  version: "0.1.0",
} as const;

/** Register every map tool on the server. */
export function registerAllTools(
  server: McpServer,
  root: string,
  index: MapIndex,
  graph?: DepGraph,
): void {
  registerGenerationTools(server, root);
  registerQueryTools(server, index, root, graph);
}
