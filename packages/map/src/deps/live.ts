/**
 * live.ts — a dependency graph that stays current while the server runs.
 *
 * `DepGraph.build` is a one-shot snapshot: files created or edited after the
 * MCP server started would never show up in `get_dependents`, which is exactly
 * when the blast radius matters. `LiveGraph` wraps one `DepGraph` and brings it
 * up to date lazily, only when a tool asks for it:
 *
 *  - No watchers, no timers: if nobody queries, nothing runs.
 *  - Within `ttlMs` of the last check the cached graph is returned untouched, so
 *    a burst of queries costs one check.
 *  - A check is `scan` + one `stat` per code file (no reads); only files whose
 *    mtime/size changed are re-read and re-parsed (see `DepGraph.sync`).
 *  - Concurrent callers share a single in-flight refresh (single-flight).
 *  - The same `DepGraph` object is updated in place, so holders of a reference
 *    (e.g. the web viewer) see later updates too.
 *
 * Failures reject the call that triggered them and are retried by the next one;
 * a failed refresh never discards the last good graph.
 */

import { scan } from "../scan.js";
import { DepGraph, type SyncReport } from "./graph.js";

/** Default window during which the cached graph is trusted without re-checking. */
export const DEFAULT_TTL_MS = 1000;

export interface LiveGraphOptions {
  /** Trust the cached graph for this long after a check. Default 1000 ms. */
  ttlMs?: number;
  /** Clock, injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** File lister, injectable for tests. Defaults to `scan`. */
  scanFiles?: (root: string) => Promise<string[]>;
}

export interface LiveGraphStats {
  /** Number of completed sync cycles, including the initial build. */
  refreshes: number;
  /** What the most recent cycle did, or null before the first one. */
  lastReport: SyncReport | null;
}

export class LiveGraph {
  private graph: DepGraph | null = null;
  private inflight: Promise<DepGraph> | null = null;
  private lastCheck = Number.NEGATIVE_INFINITY;
  private refreshes = 0;
  private lastReport: SyncReport | null = null;

  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly scanFiles: (root: string) => Promise<string[]>;

  constructor(
    private readonly root: string,
    options: LiveGraphOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.scanFiles = options.scanFiles ?? scan;
  }

  /**
   * The up-to-date graph. The first call performs the initial build; later
   * calls re-check the repository unless the TTL has not yet elapsed.
   */
  current(): Promise<DepGraph> {
    if (this.inflight) return this.inflight;
    if (this.graph && this.now() - this.lastCheck < this.ttlMs) {
      return Promise.resolve(this.graph);
    }
    const run = this.refresh();
    this.inflight = run;
    const clear = (): void => {
      if (this.inflight === run) this.inflight = null;
    };
    // Handles the rejection on this branch so a caller that ignores the
    // promise (a background warm-up) cannot cause an unhandled rejection.
    run.then(clear, clear);
    return run;
  }

  /** Counters describing the work done so far. */
  stats(): LiveGraphStats {
    return { refreshes: this.refreshes, lastReport: this.lastReport };
  }

  private async refresh(): Promise<DepGraph> {
    const startedAt = this.now();
    const files = await this.scanFiles(this.root);
    const graph = this.graph ?? DepGraph.empty(this.root);
    const report = await graph.sync(files);
    // Publish only after a successful sync, so a failed first build is retried.
    this.graph = graph;
    this.lastCheck = startedAt;
    this.lastReport = report;
    this.refreshes += 1;
    return graph;
  }
}
