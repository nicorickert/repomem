import { describe, it, expect } from "vitest";
import {
  compareVersions,
  checkForUpdates,
  fetchLatestVersion,
  formatVersions,
  installedVersions,
  updateNotice,
  type PackageVersion,
} from "../src/version.js";

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.5", "0.1.5")).toBe(0);
  });

  it("treats missing parts as zero and ignores a leading v", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("ranks a prerelease below its release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
  });

  it("returns null for unparseable input", () => {
    expect(compareVersions("unknown", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "")).toBeNull();
  });
});

describe("installedVersions", () => {
  it("reports the cli first, then memory, map and core, with real versions", () => {
    const list = installedVersions();
    expect(list.map((p) => p.name)).toEqual([
      "@repomem/cli",
      "@repomem/memory",
      "@repomem/map",
      "@repomem/core",
    ]);
    for (const p of list) expect(p.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return ((url: string) => Promise.resolve(handler(String(url)))) as unknown as typeof fetch;
}

describe("fetchLatestVersion", () => {
  it("requests the scoped package's latest tag and returns its version", async () => {
    let seen = "";
    const v = await fetchLatestVersion("@repomem/cli", {
      registry: "https://registry.example/",
      fetchFn: fakeFetch((url) => {
        seen = url;
        return Response.json({ version: "0.2.0" });
      }),
    });
    expect(seen).toBe("https://registry.example/@repomem%2fcli/latest");
    expect(v).toBe("0.2.0");
  });

  it("returns null on non-2xx, malformed body and network errors", async () => {
    expect(
      await fetchLatestVersion("x", { fetchFn: fakeFetch(() => new Response("no", { status: 404 })) }),
    ).toBeNull();
    expect(
      await fetchLatestVersion("x", { fetchFn: fakeFetch(() => Response.json({ nope: 1 })) }),
    ).toBeNull();
    const boom = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await fetchLatestVersion("x", { fetchFn: boom })).toBeNull();
  });

  it("gives up after the timeout instead of hanging", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const started = Date.now();
    expect(await fetchLatestVersion("x", { fetchFn: hang, timeoutMs: 50 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

const installed: PackageVersion[] = [
  { name: "@repomem/cli", version: "0.1.5" },
  { name: "@repomem/memory", version: "0.1.7" },
];

describe("checkForUpdates", () => {
  it("flags only strictly newer versions as outdated", async () => {
    const latest = { "@repomem/cli": "0.1.6", "@repomem/memory": "0.1.7" } as Record<string, string>;
    const result = await checkForUpdates(installed, async (n) => latest[n] ?? null);
    expect(result).toEqual([
      { name: "@repomem/cli", version: "0.1.5", latest: "0.1.6", outdated: true },
      { name: "@repomem/memory", version: "0.1.7", latest: "0.1.7", outdated: false },
    ]);
  });

  it("does not flag when the lookup fails or throws", async () => {
    const result = await checkForUpdates(installed, async (n) => {
      if (n === "@repomem/cli") throw new Error("boom");
      return null;
    });
    expect(result.every((r) => r.latest === null && !r.outdated)).toBe(true);
  });
});

describe("formatting", () => {
  const outdated = [
    { name: "@repomem/cli", version: "0.1.5", latest: "0.1.6", outdated: true },
    { name: "@repomem/memory", version: "0.1.7", latest: "0.1.7", outdated: false },
  ];

  it("lists versions without update info when no check was made", () => {
    const text = formatVersions(installed);
    expect(text).toContain("@repomem/cli");
    expect(text).toContain("0.1.5");
    expect(text).not.toContain("available");
    expect(text).not.toContain("Up to date");
  });

  it("marks outdated packages and prints the @latest command", () => {
    const text = formatVersions(installed, outdated);
    expect(text).toContain("→ 0.1.6 available");
    expect(text).toContain("npx @repomem/cli@latest setup");
  });

  it("says up to date, or that the check failed", () => {
    const same = outdated.map((s) => ({ ...s, latest: s.version, outdated: false }));
    expect(formatVersions(installed, same)).toContain("Up to date.");
    const unknown = outdated.map((s) => ({ ...s, latest: null, outdated: false }));
    expect(formatVersions(installed, unknown)).toContain("Could not check for updates");
  });

  it("builds a notice only when something is outdated", () => {
    expect(updateNotice(outdated)).toContain("@repomem/cli 0.1.5 → 0.1.6");
    expect(updateNotice(outdated)).toContain("npx @repomem/cli@latest setup");
    expect(updateNotice(outdated.map((s) => ({ ...s, outdated: false })))).toBeNull();
  });
});
