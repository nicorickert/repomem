/**
 * specs.ts — the set of servers the installer can configure, keyed by the
 * short id used on the CLI (`--servers memory,map`) and in the interactive
 * menu. Each entry carries the package's own {@link AgentSetupSpec}, imported
 * from that package's side-effect-free `/setup` subpath export.
 */

import type { AgentSetupSpec } from "@repomem/core";
import { repomemSpec } from "@repomem/memory/setup";
import { mapSpec } from "@repomem/map/setup";

/** A selectable server, as shown in the menu and accepted on the CLI. */
export interface ServerChoice {
  /** Short id used on the CLI and as the selection key. */
  id: string;
  /** Human label for the interactive menu. */
  label: string;
  /** One-line description for the interactive menu hint. */
  hint: string;
  /** The setup spec this server contributes. */
  spec: AgentSetupSpec;
  /** Whether this server is pre-selected in the interactive menu. */
  selectedByDefault: boolean;
}

/** All servers the installer knows how to configure, in display order. */
export const SERVER_CHOICES: ServerChoice[] = [
  {
    id: "memory",
    label: "memory",
    hint: "reviewable markdown memory, searchable over MCP",
    spec: repomemSpec,
    selectedByDefault: true,
  },
  {
    id: "map",
    label: "map",
    hint: "structure map and dependency graph (optional companion)",
    spec: mapSpec,
    selectedByDefault: false,
  },
];

/** Valid server ids, derived from {@link SERVER_CHOICES}. */
export const SERVER_IDS: string[] = SERVER_CHOICES.map((c) => c.id);

/** Look up a choice by id, or undefined if unknown. */
export function choiceById(id: string): ServerChoice | undefined {
  return SERVER_CHOICES.find((c) => c.id === id);
}
