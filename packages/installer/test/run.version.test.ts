import { describe, it, expect } from "vitest";
import { parseCli } from "../src/args.js";
import { runInstaller, type Prompter } from "../src/run.js";
import type { PackageVersion } from "../src/version.js";

const installed: PackageVersion[] = [
  { name: "@repomem/cli", version: "0.1.5" },
  { name: "@repomem/memory", version: "0.1.7" },
];

function collect() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (m: string) => out.push(m), err: (m: string) => err.push(m) } };
}

const cancelPrompt: Prompter = async () => null;

describe("parseCli --version", () => {
  it("recognises --version and -v as the version command", () => {
    expect(parseCli(["--version"]).command).toBe("version");
    expect(parseCli(["-v"]).command).toBe("version");
    expect(parseCli(["--version"]).error).toBeUndefined();
  });
});

describe("repomem --version", () => {
  it("prints installed versions without touching the network when no lookup is given", async () => {
    const { out, io } = collect();
    const code = await runInstaller(["--version"], { io, prompt: cancelPrompt, versions: { installed } });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("@repomem/cli");
    expect(out.join("\n")).toContain("0.1.5");
    expect(out.join("\n")).not.toContain("Up to date");
  });

  it("reports an available update with the @latest command", async () => {
    const { out, io } = collect();
    const code = await runInstaller(["--version"], {
      io,
      prompt: cancelPrompt,
      versions: { installed, latest: async (n) => (n === "@repomem/cli" ? "0.2.0" : "0.1.7") },
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("→ 0.2.0 available");
    expect(out.join("\n")).toContain("npx @repomem/cli@latest setup");
  });

  it("works with no version support injected at all", async () => {
    const { out, io } = collect();
    expect(await runInstaller(["--version"], { io, prompt: cancelPrompt })).toBe(0);
    expect(out.join("\n")).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("update notice in the interactive flow", () => {
  const outdatedLatest = async (n: string) => (n === "@repomem/cli" ? "0.2.0" : "0.1.7");

  it("prints a notice to stderr before prompting when a newer version exists", async () => {
    const { out, err, io } = collect();
    let promptedAfterNotice = false;
    const prompt: Prompter = async () => {
      promptedAfterNotice = err.some((l) => l.includes("Newer versions available"));
      return null;
    };
    await runInstaller(["setup"], { io, prompt, versions: { installed, latest: outdatedLatest } });
    expect(promptedAfterNotice).toBe(true);
    expect(err.join("\n")).toContain("npx @repomem/cli@latest setup");
    expect(out.join("\n")).not.toContain("Newer versions");
  });

  it("stays silent when everything is current or the lookup fails", async () => {
    for (const latest of [async (n: string) => installed.find((p) => p.name === n)!.version, async () => null]) {
      const { err, io } = collect();
      await runInstaller(["setup"], { io, prompt: cancelPrompt, versions: { installed, latest } });
      expect(err.join("\n")).not.toContain("Newer versions");
    }
  });

  it("never checks in non-interactive mode", async () => {
    const { err, io } = collect();
    let called = false;
    await runInstaller(["setup", "--agent", "kiro", "--servers", "bogus"], {
      io,
      prompt: cancelPrompt,
      versions: { installed, latest: async () => ((called = true), "9.9.9") },
    });
    expect(called).toBe(false);
    expect(err.join("\n")).not.toContain("Newer versions");
  });

  it("does not check when no lookup is injected (opt-out)", async () => {
    const { err, io } = collect();
    await runInstaller(["setup"], { io, prompt: cancelPrompt, versions: { installed } });
    expect(err.join("\n")).not.toContain("Newer versions");
  });
});
