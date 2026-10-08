/**
 * run.ts — installer orchestration, independent of the concrete prompt UI.
 *
 * The interactive prompter is injected so this module can be unit-tested with
 * a stub. The real CLI (cli.ts) supplies a `@clack/prompts`-backed prompter.
 */

import { runSetupMany, SUPPORTED_AGENTS, type SetupIo } from "@repomem/core";
import { parseCli, type ParsedCli } from "./args.js";
import { SERVER_CHOICES, choiceById, SERVER_IDS } from "./specs.js";

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

export interface RunOptions {
  io: SetupIo;
  prompt: Prompter;
}

function usage(io: SetupIo): void {
  io.out(
    [
      "repomem — set up your repo's memory and structure map for AI tools",
      "",
      "Usage:",
      "  repomem setup                                  Interactive setup (choose servers + agent)",
      "  repomem setup --agent <name> --servers <list>  Non-interactive (for CI/scripts)",
      "  repomem --help                                 Show this help",
      "",
      `  --servers   Comma list of: ${SERVER_IDS.join(", ")} — or "all".`,
      `  --agent     One of: ${SUPPORTED_AGENTS.join(", ")}.`,
      "  --root      Repository root (default: enclosing git root).",
      "  --force     Overwrite repomem's own existing entries.",
      "  --no-init   Skip scaffolding the memory/ folder (memory server only).",
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

  let selection: Selection | null;
  if (parsed.nonInteractive) {
    selection = { agent: parsed.agent!, servers: parsed.servers! };
  } else {
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
