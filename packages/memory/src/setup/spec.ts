/**
 * spec.ts — repomem's own {@link AgentSetupSpec}.
 *
 * Resolves asset paths relative to the compiled file location, mirroring the
 * `TEMPLATES_DIR` pattern in cli.ts so it works both from `dist/` in a
 * published package and during local development.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSetupSpec } from "@repomem/core";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/setup/spec.js -> ../../assets  (package root holds `assets/`)
const ASSETS_DIR = path.resolve(here, "..", "..", "assets");
const KIRO_ASSETS = path.join(ASSETS_DIR, "kiro");

/** The spec repomem contributes to a Kiro setup. */
export const repomemSpec: AgentSetupSpec = {
  serverName: "repomem-memory",
  mcpServer: {
    command: "npx",
    args: ["-y", "--package", "@repomem/memory", "repomem-memory", "serve"],
    env: {},
    disabled: false,
    autoApprove: ["search_memory", "get_memory", "memory_for_path"],
  },
  skills: [
    {
      id: "repomem-memory",
      srcDir: path.join(KIRO_ASSETS, "skills", "repomem-memory"),
    },
    {
      id: "repomem-distill",
      srcDir: path.join(KIRO_ASSETS, "skills", "repomem-distill"),
    },
  ],
  hookScripts: [
    {
      name: "repomem-validate.sh",
      srcPath: path.join(KIRO_ASSETS, "hooks", "repomem-validate.sh"),
    },
  ],
  agentHooks: {
    agentSpawn: [{ command: ".kiro/hooks/repomem-validate.sh" }],
  },
};
