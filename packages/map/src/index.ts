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
import { DepGraph } from "./deps/graph.js";
import { registerAllTools, SERVER_INFO, SERVER_OPTIONS } from "./server.js";

function log(message: string): void {
  process.stderr.write(`[repomem-map] ${message}\n`);
}

/**
 * Load the index and start the MCP server over stdio for the given root.
 *
 * The transport is connected BEFORE the dependency graph is built: on a large
 * repo the build can take longer than the client's startup timeout, and the
 * client only considers the server up once it answers `initialize`. The graph
 * is built in the background and handed to the tools as a promise; tools that
 * need it await it, everything else is available immediately.
 */
export async function startServer(root: string): Promise<void> {
  log(`map root: ${root}`);
  const index = await MapIndex.load(root);

  const started = Date.now();
  const graph = DepGraph.build(root);
  graph.then(
    () => log(`dependency graph ready (${Date.now() - started}ms)`),
    (e: unknown) => log(`dependency graph failed: ${(e as Error).message}`),
  );

  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  registerAllTools(server, root, index, graph);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server ready on stdio");
}
