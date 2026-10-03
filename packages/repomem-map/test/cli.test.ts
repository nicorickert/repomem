import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to the serve command with no args", () => {
    const { command, rootFlag } = parseArgs([]);
    expect(command).toBe("serve");
    expect(rootFlag).toBeUndefined();
  });

  it("treats an explicit serve the same way", () => {
    expect(parseArgs(["serve"]).command).toBe("serve");
  });

  it("reads --root", () => {
    const { command, rootFlag } = parseArgs(["serve", "--root", "/tmp/repo"]);
    expect(command).toBe("serve");
    expect(rootFlag).toBe("/tmp/repo");
  });

  it("recognizes help", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
  });
});
