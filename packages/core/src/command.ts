/**
 * command.ts — the shared `setup` subcommand body, used by both repomem and
 * repomem-map CLIs. Each package passes its own {@link AgentSetupSpec}; this
 * handles agent selection, root resolution, running the installer, and printing
 * a created / skipped / merged report.
 */

import { resolveRepoRoot } from "./root.js";
import { installForKiro, type AgentSetupSpec } from "./kiro.js";
import type { SetupReport } from "./fsops.js";

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
 * Run `setup` for a package's spec. Returns a process exit code.
 */
export async function runSetup(
  spec: AgentSetupSpec,
  args: SetupArgs,
  io: SetupIo,
): Promise<number> {
  const agent = args.agent;
  if (!agent) {
    io.err("setup requires --agent <name>. Supported: " + SUPPORTED_AGENTS.join(", "));
    return 1;
  }
  if (!SUPPORTED_AGENTS.includes(agent as SupportedAgent)) {
    io.err(
      `Unsupported agent "${agent}". Supported: ${SUPPORTED_AGENTS.join(", ")}.`,
    );
    return 1;
  }

  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot({ rootFlag: args.rootFlag });
  } catch (e) {
    io.err((e as Error).message);
    return 1;
  }

  const report = await installForKiro(spec, repoRoot, { force: args.force });
  io.out(`Configured ${spec.serverName} for ${agent} at ${repoRoot}`);
  printReport(report, io);
  return 0;
}
