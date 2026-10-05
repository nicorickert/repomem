/**
 * web/server.ts — a local HTTP server for the dependency graph viewer.
 *
 * Completely separate from the MCP stdio transport: this is a plain Node HTTP
 * server bound to localhost. It exposes `GET /graph` (returning the serialized
 * graph JSON, honoring `focus`, `depth` and `scope` query params) and serves
 * the compiled frontend static files. Nothing here reads stdin/stdout, so it
 * can run alongside the MCP server without corrupting the protocol stream.
 */

import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DepGraph } from "../deps/graph.js";
import type { MapIndex } from "../mapindex.js";
import { serializeGraph, type SerializeOptions } from "../deps/serialize.js";

/** Options for starting the viewer server. */
export interface WebServerOptions {
  root: string;
  graph: DepGraph;
  index?: MapIndex;
  /** Port to bind; 0 picks a free port (useful for tests). Default 7700. */
  port?: number;
  /** Directory of compiled frontend assets. Defaults to the bundled viewer. */
  staticDir?: string;
}

/** A running viewer server. */
export interface WebServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Default directory where the built frontend is shipped (package-root/web-dist).
 * The compiled server lives at dist/web/server.js, so go up two levels. */
const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATIC_DIR = path.resolve(here, "..", "..", "web-dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

function parseGraphQuery(url: URL): SerializeOptions {
  const opts: SerializeOptions = {};
  const scope = url.searchParams.get("scope");
  const focus = url.searchParams.get("focus");
  const depth = url.searchParams.get("depth");
  const ignore = url.searchParams.get("ignore");
  if (scope) opts.scope = scope;
  if (focus) opts.focus = focus;
  if (depth) {
    const n = Number.parseInt(depth, 10);
    if (Number.isFinite(n) && n > 0) opts.depth = n;
  }
  if (ignore) {
    const list = ignore
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (list.length > 0) opts.ignore = list;
  }
  return opts;
}

/** Resolve a URL path to a file inside staticDir, guarding against traversal. */
async function resolveStatic(staticDir: string, urlPath: string): Promise<string | null> {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const abs = path.resolve(staticDir, rel);
  // Prevent path traversal outside the static root.
  if (abs !== staticDir && !abs.startsWith(staticDir + path.sep)) return null;
  try {
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) return null;
    return abs;
  } catch {
    return null;
  }
}

/** Start the viewer HTTP server. Resolves once it is listening. */
export function startWebServer(options: WebServerOptions): Promise<WebServerHandle> {
  const { graph, index } = options;
  const staticDir = options.staticDir ?? DEFAULT_STATIC_DIR;
  const port = options.port ?? 7700;

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/graph") {
      const model = serializeGraph(graph, parseGraphQuery(url), index);
      const body = JSON.stringify(model);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(body);
      return;
    }

    const file = await resolveStatic(staticDir, url.pathname);
    if (file) {
      const ext = path.extname(file).toLowerCase();
      const body = await fs.readFile(file);
      res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  return new Promise<WebServerHandle>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        url: `http://127.0.0.1:${boundPort}`,
        port: boundPort,
        close: () =>
          new Promise<void>((res2, rej2) => {
            server.close((err) => (err ? rej2(err) : res2()));
          }),
      });
    });
  });
}
