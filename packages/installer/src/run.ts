/**
 * run.ts — installer orchestration, independent of the concrete prompt UI.
 *
 * The interactive prompter is injected so this module can be unit-tested with
 * a stub. The real CLI (cli.ts) supplies a `@clack/prompts`-backed prompter.
 */

import { runSetupMany, SUPPORTED_AGENTS, type SetupIo } from "@repomem/core";
import { parseCli, type ParsedCli } from "./args.js";
import { SERVER_CHOICES, choiceById, SERVER_IDS } from "./specs.js";
import {
  NO_UPDATE_CHECK_ENV,
  checkForUpdates,
  formatVersions,
  installedVersions,
  updateNotice,
  type PackageVersion,
} from "./version.js";

/** What the interactive menu must collect. */
export interface Selection {
  agent: string;
  servers: string[];
}

/**
 * An interactive prompter. Returns the user's selection, or `null` when the
 * user cancels (e.g. Ctrl+C). Injected to keep {@link runInstaller} testable.
 */
export type Prompter = (defaults: {
  agents: readonly string[];
  servers: typeof SERVER_CHOICES;
}) => Promise<Selection | null>;

/** What the installer needs to report versions and look for newer ones. */
export interface VersionSupport {
  /** Versions found in this installation. */
  installed: PackageVersion[];
  /**
   * Latest published version of a package, or null if unknown. Omit to disable
   * every registry lookup (e.g. when the user opted out).
   */
  latest?: (name: string) => Promise<string | null>;
}

export interface RunOptions {
  io: SetupIo;
  prompt: Prompter;
  /** Defaults to the real installed versions, with no registry lookup. */
  versions?: VersionSupport;
}

function usage(io: SetupIo): void {
  io.out(
    [
      "repomem — set up your repo's memory and structure map for AI tools",
      "",
      "Usage:",
      "  repomem setup                                  Interactive setup (choose servers + agent)",
      "  repomem setup --agent <name> --servers <list>  Non-interactive (for CI/scripts)",
      "  repomem --version                              Show versions and check for a newer release",
      "  repomem --help                                 Show this help",
      "",
      `  --servers   Comma list of: ${SERVER_IDS.join(", ")} — or "all".`,
      `  --agent     One of: ${SUPPORTED_AGENTS.join(", ")}.`,
      "  --root      Repository root (default: enclosing git root).",
      "  --force     Refresh repomem's own entries and files (skills, hook scripts, MCP config) to the current version.",
      "  --no-init   Skip scaffolding the memory/ folder (memory server only).",
      "",
      `Set ${NO_UPDATE_CHECK_ENV}=1 to disable the npm registry lookup for newer versions.`,
      "",
      "Each server can also be configured on its own with the scoped packages:",
      "  npx --package @repomem/memory repomem-memory setup --agent <name>",
      "  npx --package @repomem/map    repomem-map    setup --agent <name>",
    ].join("\n"),
  );
}

/**
 * Run the installer end to end. Returns a process exit code.
 *
 * - `--help` (or no/unknown command) prints usage.
 * - With `--agent` and `--servers`, runs non-interactively.
 * - Otherwise invokes the injected prompter to collect the selection.
 */
export async function runInstaller(argv: string[], opts: RunOptions): Promise<number> {
  const { io, prompt } = opts;
  const parsed = parseCli(argv);

  if (parsed.error) {
    io.err(parsed.error);
    if (parsed.command === "help") usage(io);
    return 1;
  }

  if (parsed.command === "help") {
    usage(io);
    return 0;
  }

  const versions = opts.versions ?? { installed: installedVersions() };

  if (parsed.command === "version") {
    const statuses = versions.latest
      ? await checkForUpdates(versions.installed, versions.latest)
      : undefined;
    io.out(formatVersions(versions.installed, statuses));
    return 0;
  }

  let selection: Selection | null;
  if (parsed.nonInteractive) {
    selection = { agent: parsed.agent!, servers: parsed.servers! };
  } else {
    // Interactive only: scripts and CI never trigger a registry lookup. The
    // notice goes to stderr so it cannot pollute captured stdout.
    if (versions.latest) {
      const notice = updateNotice(await checkForUpdates(versions.installed, versions.latest));
      if (notice) io.err(notice);
    }
    selection = await prompt({ agents: SUPPORTED_AGENTS, servers: SERVER_CHOICES });
    if (selection === null) {
      io.err("Cancelled.");
      return 1;
    }
  }

  return runSelection(selection, parsed, io);
}

/** Resolve the selection to specs and delegate to the core orchestrator. */
async function runSelection(
  selection: Selection,
  parsed: ParsedCli,
  io: SetupIo,
): Promise<number> {
  if (selection.servers.length === 0) {
    io.err("No servers selected; nothing to do.");
    return 1;
  }

  const specs = [];
  for (const id of selection.servers) {
    const choice = choiceById(id);
    if (!choice) {
      io.err(`Unknown server: ${id}. Valid: ${SERVER_IDS.join(", ")}.`);
      return 1;
    }
    specs.push(choice.spec);
  }

  return runSetupMany(
    specs,
    {
      agent: selection.agent,
      rootFlag: parsed.rootFlag,
      force: parsed.force,
      skipPostSetup: parsed.skipInit,
    },
    io,
  );
}
