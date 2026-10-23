/**
 * version.ts — installed versions of the repomem packages and a best-effort
 * check for newer ones on the npm registry.
 *
 * The check is deliberately weak: it has a short timeout, never throws, and a
 * failure (offline, registry down, odd response) just means "unknown". It only
 * sends the package name to the registry — no project data.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The packages whose versions are reported, the installer first. */
export const REPORTED_PACKAGES = [
  "@repomem/cli",
  "@repomem/memory",
  "@repomem/map",
  "@repomem/core",
] as const;

/** The installer's own package name. */
export const SELF_PACKAGE = "@repomem/cli";

/** Environment variable that disables every registry lookup when set. */
export const NO_UPDATE_CHECK_ENV = "REPOMEM_NO_UPDATE_CHECK";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 2000;

export interface PackageVersion {
  name: string;
  version: string;
}

export interface UpdateStatus extends PackageVersion {
  /** Latest published version, or null when it could not be determined. */
  latest: string | null;
  /** True only when `latest` is known and strictly newer than `version`. */
  outdated: boolean;
}

function readPackageJson(file: string): { name?: string; version?: string } | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
  } catch {
    return null;
  }
}

/**
 * Version of `name` as resolved from this installation. Dependencies restrict
 * their `exports`, so `package.json` cannot be resolved directly: resolve the
 * entry point and walk up to the `package.json` carrying that name.
 */
function resolveDependencyVersion(name: string): string | null {
  try {
    let dir = path.dirname(createRequire(import.meta.url).resolve(name));
    for (;;) {
      const pkg = readPackageJson(path.join(dir, "package.json"));
      if (pkg?.name === name) return pkg.version ?? null;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

/** Versions of the reported packages found in this installation. */
export function installedVersions(): PackageVersion[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // `src/` and `dist/` both sit one level below the package root.
  const self = readPackageJson(path.resolve(here, "..", "package.json"));
  const out: PackageVersion[] = [
    { name: SELF_PACKAGE, version: self?.version ?? "unknown" },
  ];
  for (const name of REPORTED_PACKAGES) {
    if (name === SELF_PACKAGE) continue;
    out.push({ name, version: resolveDependencyVersion(name) ?? "unknown" });
  }
  return out;
}

/** Split `1.2.3-beta.1` into numeric core parts and a prerelease flag. */
function parseVersion(v: string): { core: number[]; pre: boolean } | null {
  const [core, pre] = v.trim().replace(/^v/, "").split(/-(.*)/s);
  if (!core || !/^\d+(\.\d+)*$/.test(core)) return null;
  return { core: core.split(".").map(Number), pre: pre !== undefined && pre !== "" };
}

/**
 * Compare two versions: negative if a < b, 0 if equal, positive if a > b.
 * Returns null when either is not a parseable version. Prerelease tags only
 * break ties (`1.0.0-rc.1` < `1.0.0`); two prereleases of one core compare equal.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.pre === pb.pre) return 0;
  return pa.pre ? -1 : 1;
}

export interface FetchLatestOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  registry?: string;
}

/**
 * The `latest` dist-tag of `name` on the registry, or null on any failure
 * (network error, timeout, non-2xx, malformed body). Never throws.
 */
export async function fetchLatestVersion(
  name: string,
  options: FetchLatestOptions = {},
): Promise<string | null> {
  const fetchFn = options.fetchFn ?? fetch;
  const registry = (options.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
  try {
    const res = await fetchFn(`${registry}/${name.replace("/", "%2f")}/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/** Look up the latest version of each package concurrently. Never throws. */
export async function checkForUpdates(
  installed: readonly PackageVersion[],
  latest: (name: string) => Promise<string | null>,
): Promise<UpdateStatus[]> {
  return Promise.all(
    installed.map(async (pkg) => {
      const found = await latest(pkg.name).catch(() => null);
      const cmp = found === null ? null : compareVersions(pkg.version, found);
      return { ...pkg, latest: found, outdated: cmp !== null && cmp < 0 };
    }),
  );
}

/** The command that runs the installer at the newest published version. */
export const LATEST_COMMAND = "npx @repomem/cli@latest setup";

/** Lines for `repomem --version`, with update info when `statuses` is given. */
export function formatVersions(
  installed: readonly PackageVersion[],
  statuses?: readonly UpdateStatus[],
): string {
  const width = Math.max(...installed.map((p) => p.name.length));
  const lines = installed.map((pkg) => {
    const status = statuses?.find((s) => s.name === pkg.name);
    const hint = status?.outdated ? `  → ${status.latest} available` : "";
    return `${pkg.name.padEnd(width)}  ${pkg.version}${hint}`;
  });
  if (statuses) {
    if (statuses.some((s) => s.outdated)) {
      lines.push("", `Newer versions are available. Run with the latest: ${LATEST_COMMAND}`);
    } else if (statuses.every((s) => s.latest === null)) {
      lines.push("", "Could not check for updates (offline?).");
    } else {
      lines.push("", "Up to date.");
    }
  }
  return lines.join("\n");
}

/** One-line notice for the interactive flow, or null when nothing is outdated. */
export function updateNotice(statuses: readonly UpdateStatus[]): string | null {
  const outdated = statuses.filter((s) => s.outdated);
  if (outdated.length === 0) return null;
  const list = outdated.map((s) => `${s.name} ${s.version} → ${s.latest}`).join(", ");
  return `Newer versions available: ${list}. Run with the latest: ${LATEST_COMMAND}`;
}
