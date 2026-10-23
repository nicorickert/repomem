/**
 * repomem — one-command installer for the repomem MCP servers.
 *
 * Public, testable surface. The executable entry point is `cli.ts`.
 */

export { parseCli, parseServers, type ParsedCli, type Command } from "./args.js";
export {
  runInstaller,
  type Prompter,
  type Selection,
  type RunOptions,
  type VersionSupport,
} from "./run.js";
export {
  installedVersions,
  fetchLatestVersion,
  checkForUpdates,
  compareVersions,
  type PackageVersion,
  type UpdateStatus,
} from "./version.js";
export {
  SERVER_CHOICES,
  SERVER_IDS,
  choiceById,
  type ServerChoice,
} from "./specs.js";
