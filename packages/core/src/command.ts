/**
 * command.ts — the shared `setup` subcommand body, used by both repomem and
 * repomem-map CLIs. Each package passes its own {@link AgentSetupSpec}; this
 * handles agent selection, root resolution, running the installer, and printing
 * a created / skipped / merged report.
 */

import { resolveRepoRoot } from "./root.js";
import { installForKiro, type AgentSetupSpec } from "./kiro.js";
import { mergeReports, emptyReport, type SetupReport } from "./fsops.js";

/** Agents supported today. Extend by adding a sibling installer. */
export const SUPPORTED_AGENTS = ["kiro"] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

export interface SetupArgs {
  agent?: string;
  rootFlag?: string;
  force?: boolean;
}

export interface SetupIo {
  out: (message: string) => void;
  err: (message: string) => void;
}

function printReport(report: SetupReport, io: SetupIo): void {
  if (report.created.length) {
    io.out(`  created:\n${report.created.map((c) => `    + ${c}`).join("\n")}`);
  }
  if (report.merged.length) {
    io.out(`  merged:\n${report.merged.map((c) => `    ~ ${c}`).join("\n")}`);
  }
  if (report.skipped.length) {
    io.out(`  already present (left untouched):\n${report.skipped.map((c) => `    = ${c}`).join("\n")}`);
  }
}

/**
 * Validate the requested agent. Returns an error message, or null if valid.
 */
function validateAgent(agent?: string): string | null {
  if (!agent) {
    return "setup requires --agent <name>. Supported: " + SUPPORTED_AGENTS.join(", ");
  }
  if (!SUPPORTED_AGENTS.includes(agent as SupportedAgent)) {
    return `Unsupported agent "${agent}". Supported: ${SUPPORTED_AGENTS.join(", ")}.`;
  }
  return null;
}

/**
 * Run `setup` for a single package's spec. Returns a process exit code.
 */
export async function runSetup(
  spec: AgentSetupSpec,
  args: SetupArgs,
  io: SetupIo,
): Promise<number> {
  return runSetupMany([spec], args, io);
}

/**
 * Run `setup` for several specs at once against the same repository root.
 *
 * Used by the unified `repomem setup` installer to configure the memory and
 * map servers in one pass. Resolves the repo root once, installs each spec in
 * order, and prints a combined created / merged / skipped report. The install
 * work in {@link installForKiro} is additive and idempotent, so running
 * multiple specs that share the `repomem` agent config accumulates cleanly.
 *
 * Returns a process exit code (0 on success, non-zero on validation failure).
 */
export async function runSetupMany(
  specs: AgentSetupSpec[],
  args: SetupArgs,
  io: SetupIo,
): Promise<number> {
  const { agent } = args;
  const agentError = validateAgent(agent);
  if (agentError) {
    io.err(agentError);
    return 1;
  }

  if (specs.length === 0) {
    io.err("setup requires at least one server to configure.");
    return 1;
  }

  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot({ rootFlag: args.rootFlag });
  } catch (e) {
    io.err((e as Error).message);
    return 1;
  }

  const combined = emptyReport();
  for (const spec of specs) {
    const report = await installForKiro(spec, repoRoot, { force: args.force });
    io.out(`Configured ${spec.serverName} for ${agent} at ${repoRoot}`);
    printReport(report, io);
    mergeReports(combined, report);
  }
  return 0;
}
