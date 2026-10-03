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

  it("recognizes the graph command and reads --port", () => {
    const { command, portFlag } = parseArgs(["graph", "--port", "1234"]);
    expect(command).toBe("graph");
    expect(portFlag).toBe(1234);
  });

  it("reads --root alongside graph", () => {
    const { command, rootFlag, portFlag } = parseArgs(["graph", "--root", "/tmp/repo"]);
    expect(command).toBe("graph");
    expect(rootFlag).toBe("/tmp/repo");
    expect(portFlag).toBeUndefined();
  });
});
