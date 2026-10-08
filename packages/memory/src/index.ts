/**
 * index.ts — bootstrap. Wires the McpServer to a StdioServerTransport.
 *
 * All logging goes to stderr; stdout is reserved for the MCP protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveMemoryRoot } from "./store.js";
import { MemoryIndex } from "./search.js";
import { registerAllTools, SERVER_INFO } from "./server.js";

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
  registerAllTools(server, root, index);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server ready on stdio");
}

// Only auto-run when invoked directly (e.g. `node dist/index.js`), not when
// imported (the CLI imports `main` to implement the `serve` subcommand).
// realpathSync canonicalises both sides so a symlinked bin still matches.
function isInvokedDirectly(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main().catch((err: unknown) => {
    log(`fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
