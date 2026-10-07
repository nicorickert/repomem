/**
 * setup/index.ts — public entrypoint for the shared `setup` utilities.
 *
 * Both repomem and repomem-map build their per-package `setup` commands on top
 * of these helpers. repomem-map imports them via `repomem/setup`.
 */

export {
  copyIfAbsent,
  copyExecutable,
  ensureDir,
  deepMergeAdditive,
  mergeJsonAdditive,
  mergeReports,
  emptyReport,
  type SetupReport,
} from "./fsops.js";

export { resolveRepoRoot, type ResolveRepoRootOptions } from "./root.js";

export {
  installForKiro,
  type AgentSetupSpec,
  type McpServerEntry,
  type KiroHook,
  type KiroHooks,
  type SkillSource,
  type HookScriptSource,
  type InstallOptions,
} from "./kiro.js";

export {
  runSetup,
  SUPPORTED_AGENTS,
  type SupportedAgent,
  type SetupArgs,
  type SetupIo,
} from "./command.js";
