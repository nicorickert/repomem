/**
 * spec.ts — repomem-map's own AgentSetupSpec.
 *
 * Reuses the shared installer and types from `repomem/setup`. Asset paths are
 * resolved relative to the compiled file location, mirroring repomem's pattern
 * so it works from `dist/` in a published package and during development.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSetupSpec } from "@repomem/core";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/setup/spec.js -> ../../assets  (package root holds `assets/`)
const ASSETS_DIR = path.resolve(here, "..", "..", "assets");
const KIRO_ASSETS = path.join(ASSETS_DIR, "kiro");

/** The spec repomem-map contributes to a Kiro setup. */
export const mapSpec: AgentSetupSpec = {
  serverName: "repomem-map",
  mcpServer: {
    command: "npx",
    args: ["-y", "--package", "@repomem/map", "repomem-map", "serve"],
    env: {},
    disabled: false,
    autoApprove: ["find_code", "get_module", "request_summaries", "open_graph"],
  },
  skills: [
    {
      id: "repomem-map-structure",
      srcDir: path.join(KIRO_ASSETS, "skills", "repomem-map-structure"),
    },
  ],
};
