/**
 * @repomem/core — shared setup toolkit used by @repomem/memory and
 * @repomem/map to install skills, hooks and MCP config into an agent.
 *
 * This package is agent-infrastructure only: it knows nothing about the memory
 * or structure-map domains. Each consumer supplies its own {@link AgentSetupSpec}.
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

export { findGitRoot } from "./git.js";

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
