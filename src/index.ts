/**
 * index.ts — bootstrap. Wires the McpServer to a StdioServerTransport.
 *
 * All logging goes to stderr; stdout is reserved for the MCP protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveMemoryRoot } from "./store.js";
import { MemoryIndex } from "./search.js";
import { registerReadTools, SERVER_INFO } from "./server.js";

function log(message: string): void {
  process.stderr.write(`[repomem] ${message}\n`);
}

/** Read an optional `--root <path>` from argv. */
function parseRootFlag(argv: string[]): string | undefined {
  const i = argv.indexOf("--root");
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const root = resolveMemoryRoot({ rootFlag: parseRootFlag(argv) });
  log(`memory root: ${root}`);

  const index = new MemoryIndex(root);
  const server = new McpServer(SERVER_INFO);
  registerReadTools(server, index);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server ready on stdio");
}

main().catch((err: unknown) => {
  log(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
