#!/usr/bin/env node
/**
 * repomem-map CLI — PLANNED.
 *
 * This package is a scaffold. None of the map features (find_code,
 * get_module, get_dependents, repo_overview, summary generation,
 * `--check`) are implemented yet. See docs for the intended design.
 *
 * The map is an optional companion to `repomem` (memory). The core
 * `repomem` package does not depend on this package; this package may
 * call the core through its public `memory_for_path` contract.
 */

function main(): void {
  console.error(
    "repomem-map is planned and not implemented yet. " +
      "This is a scaffold package in the repomem monorepo.",
  );
  process.exitCode = 1;
}

main();
