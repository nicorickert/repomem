/**
 * web/launch.ts — start the viewer and (best-effort) open a browser.
 *
 * Shared by the CLI `graph` subcommand and the MCP `open_graph` tool so both
 * behave identically. Opening the browser never fails the call: in a headless
 * environment the server still starts and the URL is returned. Running viewers
 * are tracked so tests (and a future shutdown path) can close them.
 */

import { spawn } from "node:child_process";
import { DepGraph } from "../deps/graph.js";
import type { MapIndex } from "../mapindex.js";
import { startWebServer, type WebServerHandle } from "./server.js";

const running = new Set<WebServerHandle>();

/** Options for launching the viewer. */
export interface LaunchOptions {
  root: string;
  /** Reuse an already-built graph; otherwise one is built from `root`. */
  graph?: DepGraph;
  index?: MapIndex;
  port?: number;
  /** Attempt to open the system browser at the viewer URL. Default false. */
  openBrowser?: boolean;
}

/** Currently running viewer handles. */
export function getRunningViewers(): WebServerHandle[] {
  return [...running];
}

/** Close every running viewer (used by tests and shutdown). */
export async function stopAllViewers(): Promise<void> {
  await Promise.all([...running].map((h) => h.close()));
  running.clear();
}

/** Best-effort open of a URL in the system browser; never throws. */
export function openInBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* no browser available; ignore */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

/** Build (if needed) the graph, start the viewer, and optionally open it. */
export async function launchViewer(options: LaunchOptions): Promise<WebServerHandle> {
  const graph = options.graph ?? (await DepGraph.build(options.root));
  const handle = await startWebServer({
    root: options.root,
    graph,
    index: options.index,
    port: options.port,
  });
  running.add(handle);
  const originalClose = handle.close;
  handle.close = async () => {
    running.delete(handle);
    await originalClose();
  };
  if (options.openBrowser) openInBrowser(handle.url);
  return handle;
}
