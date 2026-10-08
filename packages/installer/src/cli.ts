#!/usr/bin/env node
/**
 * cli.ts — the `repomem` installer binary.
 *
 *   repomem setup                                  interactive setup
 *   repomem setup --agent kiro --servers all       non-interactive
 *   repomem --help                                 usage
 *
 * This file owns the concrete interactive UI (@clack/prompts). All parsing and
 * orchestration lives in args.ts / run.ts and is covered by unit tests; the
 * prompter here is injected into {@link runInstaller}.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  intro,
  outro,
  multiselect,
  select,
  isCancel,
  cancel,
} from "@clack/prompts";
import { runInstaller, type Prompter, type Selection } from "./run.js";

function out(message: string): void {
  process.stdout.write(message + "\n");
}
function err(message: string): void {
  process.stderr.write(message + "\n");
}

/** The real interactive prompter, backed by @clack/prompts. */
const clackPrompter: Prompter = async ({ agents, servers }) => {
  intro("repomem setup");

  const picked = await multiselect<string>({
    message: "Which servers do you want to configure?",
    options: servers.map((s) => ({
      value: s.id,
      label: s.label,
      hint: s.hint,
    })),
    initialValues: servers.filter((s) => s.selectedByDefault).map((s) => s.id),
    required: true,
  });
  if (isCancel(picked)) {
    cancel("Cancelled.");
    return null;
  }

  const agent = await select<string>({
    message: "Which AI tool / agent?",
    options: agents.map((a) => ({ value: a, label: a })),
    initialValue: agents[0],
  });
  if (isCancel(agent)) {
    cancel("Cancelled.");
    return null;
  }

  const selection: Selection = { agent, servers: picked };
  outro(`Configuring ${picked.join(", ")} for ${agent}…`);
  return selection;
};

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  return runInstaller(argv, { io: { out, err }, prompt: clackPrompter });
}

// Only auto-run when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  run()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      err(`fatal: ${(e as Error).message}`);
      process.exit(1);
    });
}
