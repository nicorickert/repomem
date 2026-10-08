/**
 * kiro.ts — shared installer that wires a package's {@link AgentSetupSpec} into
 * a Kiro workspace. Each package (repomem, repomem-map) supplies its own spec;
 * this module performs the idempotent, additive filesystem work.
 *
 * It writes, under the repository root:
 *   - `.kiro/skills/<id>/SKILL.md`   (copied, never overwritten)
 *   - `.kiro/hooks/<name>`           (copied executable, never overwritten)
 *   - `.kiro/agents/repomem.json`    (merged: mcpServers, resources, hooks)
 *   - `.kiro/settings/mcp.json`      (merged: mcpServers)
 *
 * The agent config is shared across packages (a single `repomem` agent that
 * accumulates both servers and both skill sets). All merges are additive and
 * preserve foreign keys; a package only ever touches its own entries unless
 * `force` is set.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  copyIfAbsent,
  copyExecutable,
  ensureDir,
  mergeJsonAdditive,
  mergeReports,
  emptyReport,
  type SetupReport,
} from "./fsops.js";

/** A single MCP server entry, as it appears under `mcpServers`. */
export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  autoApprove?: string[];
  [key: string]: unknown;
}

/** A single hook invocation. */
export interface KiroHook {
  command: string;
  matcher?: string;
  timeout_ms?: number;
}

/** Hooks grouped by lifecycle trigger. */
export interface KiroHooks {
  agentSpawn?: KiroHook[];
  userPromptSubmit?: KiroHook[];
  preToolUse?: KiroHook[];
  postToolUse?: KiroHook[];
  stop?: KiroHook[];
}

/** A skill to copy into `.kiro/skills/<id>/`. */
export interface SkillSource {
  /** Directory name under `.kiro/skills/` (e.g. "repomem-memory"). */
  id: string;
  /** Absolute path to the source directory holding SKILL.md (and friends). */
  srcDir: string;
}

/** A hook script to copy into `.kiro/hooks/`. */
export interface HookScriptSource {
  /** Destination file name under `.kiro/hooks/` (e.g. "repomem-validate.sh"). */
  name: string;
  /** Absolute path to the source script. */
  srcPath: string;
}

/** Output sink for setup commands: `out` for stdout, `err` for stderr. */
export interface SetupIo {
  out: (message: string) => void;
  err: (message: string) => void;
}

/**
 * Everything a package contributes to a Kiro setup. The installer is otherwise
 * agent-agnostic — adding another agent means adding a sibling installer that
 * consumes the same spec.
 */
export interface AgentSetupSpec {
  /** MCP server name, e.g. "repomem" or "repomem-map". */
  serverName: string;
  /** The MCP server entry written to both mcp.json and the agent config. */
  mcpServer: McpServerEntry;
  /** Skills copied into `.kiro/skills/`. */
  skills: SkillSource[];
  /** Optional hook scripts copied into `.kiro/hooks/`. */
  hookScripts?: HookScriptSource[];
  /** Optional hooks block merged into the agent config. */
  agentHooks?: KiroHooks;
  /**
   * Optional domain-specific step run after the agent files are installed.
   * Core stays agnostic: it only invokes this callback (unless the caller
   * opts out via `skipPostSetup`). The memory package uses it to scaffold the
   * reviewable `memory/` folder so `setup` also initialises content.
   *
   * @param repoRoot the resolved repository root `.kiro/` was written under
   * @param io       the same output sink used by the setup command
   */
  postSetup?: (repoRoot: string, io: SetupIo) => Promise<void>;
}

export interface InstallOptions {
  force?: boolean;
}

/** The shared agent config file name (one agent, many servers). */
const AGENT_NAME = "repomem";

type Json = Record<string, unknown>;

/** Union-merge an array of strings, preserving order and de-duplicating. */
function unionStrings(existing: unknown, additions: string[]): string[] {
  const out: string[] = Array.isArray(existing)
    ? existing.filter((v): v is string => typeof v === "string")
    : [];
  for (const a of additions) if (!out.includes(a)) out.push(a);
  return out;
}

/** Append hooks per trigger without duplicating identical commands. */
function mergeHooks(existing: unknown, additions: KiroHooks, force: boolean): Json {
  const base: Json = isPlainObject(existing) ? { ...existing } : {};
  for (const [trigger, hooks] of Object.entries(additions)) {
    if (!Array.isArray(hooks)) continue;
    const current = Array.isArray(base[trigger]) ? (base[trigger] as KiroHook[]) : [];
    if (force) {
      base[trigger] = hooks;
      continue;
    }
    const merged = [...current];
    for (const h of hooks) {
      const dup = merged.some(
        (e) => e.command === h.command && e.matcher === h.matcher,
      );
      if (!dup) merged.push(h);
    }
    base[trigger] = merged;
  }
  return base;
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(p: string): Promise<Json> {
  if (!existsSync(p)) return {};
  const raw = (await fs.readFile(p, "utf8")).trim();
  if (raw === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) throw new Error(`Expected a JSON object at ${p}`);
  return parsed;
}

/**
 * Install `spec` into the Kiro workspace rooted at `repoRoot`.
 * Returns an aggregated report of created / skipped / merged paths.
 */
export async function installForKiro(
  spec: AgentSetupSpec,
  repoRoot: string,
  options: InstallOptions = {},
): Promise<SetupReport> {
  const force = options.force ?? false;
  const report = emptyReport();

  const kiroDir = path.join(repoRoot, ".kiro");
  const skillsDir = path.join(kiroDir, "skills");
  const hooksDir = path.join(kiroDir, "hooks");
  const agentPath = path.join(kiroDir, "agents", `${AGENT_NAME}.json`);
  const mcpPath = path.join(kiroDir, "settings", "mcp.json");

  // 1. Copy skills (every file in each skill's source directory).
  const skillResourceUris: string[] = [];
  for (const skill of spec.skills) {
    const destDir = path.join(skillsDir, skill.id);
    await ensureDir(destDir);
    const entries = await fs.readdir(skill.srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      mergeReports(
        report,
        await copyIfAbsent(
          path.join(skill.srcDir, entry.name),
          path.join(destDir, entry.name),
        ),
      );
    }
    // Reference the skill's SKILL.md if present, else the whole folder glob.
    skillResourceUris.push(`skill://.kiro/skills/${skill.id}/SKILL.md`);
  }

  // 2. Copy hook scripts (executable).
  for (const hook of spec.hookScripts ?? []) {
    mergeReports(
      report,
      await copyExecutable(hook.srcPath, path.join(hooksDir, hook.name)),
    );
  }

  // 3. Merge the shared agent config. Arrays (resources, hooks) need
  //    structure-aware union/append that deepMergeAdditive does not provide,
  //    so build the merged object explicitly here.
  const agent = await readJsonObject(agentPath);
  const agentExisted = existsSync(agentPath);

  if (!("name" in agent)) agent.name = AGENT_NAME;
  if (!("description" in agent)) {
    agent.description = "repomem agent: shared memory and structure map over MCP.";
  }

  const mcpServers = isPlainObject(agent.mcpServers) ? { ...agent.mcpServers } : {};
  if (!(spec.serverName in mcpServers) || force) {
    mcpServers[spec.serverName] = spec.mcpServer;
  }
  agent.mcpServers = mcpServers;

  agent.resources = unionStrings(agent.resources, skillResourceUris);

  if (spec.agentHooks && Object.keys(spec.agentHooks).length > 0) {
    agent.hooks = mergeHooks(agent.hooks, spec.agentHooks, force);
  }

  await ensureDir(path.dirname(agentPath));
  await fs.writeFile(agentPath, JSON.stringify(agent, null, 2) + "\n", "utf8");
  if (agentExisted) report.merged.push(agentPath);
  else report.created.push(agentPath);

  // 4. Merge the workspace MCP settings (additive; keep foreign servers).
  mergeReports(
    report,
    await mergeJsonAdditive(
      mcpPath,
      { mcpServers: { [spec.serverName]: spec.mcpServer } },
      { force },
    ),
  );

  return report;
}
