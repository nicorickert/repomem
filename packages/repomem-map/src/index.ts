/**
 * index.ts — bootstrap. Wires the McpServer to a StdioServerTransport.
 *
 * Loads the map index from the committed summaries, registers the four tools,
 * and serves over stdio. All logging goes to stderr; stdout is reserved for
 * the MCP protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MapIndex } from "./mapindex.js";
import { registerAllTools, SERVER_INFO } from "./server.js";

function log(message: string): void {
  process.stderr.write(`[repomem-map] ${message}\n`);
}

/** Load the index and start the MCP server over stdio for the given root. */
export async function startServer(root: string): Promise<void> {
  log(`map root: ${root}`);
  const index = await MapIndex.load(root);
  const server = new McpServer(SERVER_INFO);
  registerAllTools(server, root, index);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server ready on stdio");
}
