/**
 * args.ts — pure, side-effect-free parsing of the installer CLI arguments.
 *
 * Kept separate from the interactive layer so the parsing and validation rules
 * can be unit-tested without spawning prompts.
 *
 * Usage:
 *   repomem setup                                  interactive menu
 *   repomem setup --agent kiro --servers memory    non-interactive
 *   repomem setup --agent kiro --servers all       non-interactive, all servers
 *   repomem [--help]                               usage
 */

import { SERVER_IDS } from "./specs.js";

export type Command = "setup" | "help";

/** The result of parsing argv. A `help` command short-circuits everything. */
export interface ParsedCli {
  command: Command;
  /** `--agent <name>`, if provided. */
  agent?: string;
  /**
   * Resolved list of server ids to configure, if `--servers` was provided.
   * `undefined` means "not specified" (prompt interactively).
   */
  servers?: string[];
  /** `--root <dir>`, forwarded to repo-root resolution. */
  rootFlag?: string;
  /** `--force` to overwrite own existing entries. */
  force: boolean;
  /** `--no-init` to skip memory-folder scaffolding (postSetup). */
  skipInit: boolean;
  /**
   * True when enough was supplied on the CLI to skip the interactive menu
   * (both an agent and an explicit server selection).
   */
  nonInteractive: boolean;
  /** A parse/validation error message, if any. When set, callers should fail. */
  error?: string;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

/**
 * Parse a `--servers` value into a validated list of ids.
 * Accepts a comma-separated list (`memory,map`) or the keyword `all`.
 * Returns either `{ servers }` or `{ error }`.
 */
export function parseServers(raw: string): { servers?: string[]; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "--servers was given an empty value." };
  if (trimmed.toLowerCase() === "all") return { servers: [...SERVER_IDS] };

  const ids = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (ids.length === 0) return { error: "--servers was given an empty value." };

  const unknown = ids.filter((id) => !SERVER_IDS.includes(id));
  if (unknown.length > 0) {
    return {
      error: `Unknown server(s): ${unknown.join(", ")}. Valid: ${SERVER_IDS.join(", ")}, or "all".`,
    };
  }

  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const deduped = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  return { servers: deduped };
}

/** Parse argv (already sliced past the node/bin entries) into a {@link ParsedCli}. */
export function parseCli(argv: string[]): ParsedCli {
  const first = argv[0];

  if (!first || first === "--help" || first === "-h" || first === "help") {
    return { command: "help", force: false, skipInit: false, nonInteractive: false };
  }

  if (first !== "setup") {
    return {
      command: "help",
      force: false,
      skipInit: false,
      nonInteractive: false,
      error: `Unknown command: ${first}`,
    };
  }

  const agent = flag(argv, "--agent");
  const rootFlag = flag(argv, "--root");
  const force = hasFlag(argv, "--force");
  const skipInit = hasFlag(argv, "--no-init");

  let servers: string[] | undefined;
  const rawServers = flag(argv, "--servers");
  if (rawServers !== undefined) {
    const result = parseServers(rawServers);
    if (result.error) {
      return { command: "setup", agent, rootFlag, force, skipInit, nonInteractive: false, error: result.error };
    }
    servers = result.servers;
  }

  // Non-interactive only when both an agent and a server selection are present.
  const nonInteractive = agent !== undefined && servers !== undefined;

  return { command: "setup", agent, servers, rootFlag, force, skipInit, nonInteractive };
}
