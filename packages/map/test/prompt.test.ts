import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadPrompt } from "../src/prompt.js";

describe("loadPrompt", () => {
  it("loads the default summary prompt as non-empty text", async () => {
    const text = await loadPrompt();
    expect(typeof text).toBe("string");
    expect(text.trim().length).toBeGreaterThan(0);
    // mentions the two things the agent must produce
    expect(text.toLowerCase()).toContain("summary");
    expect(text.toLowerCase()).toContain("search_terms");
  });

  it("throws a clear error when the prompt file is missing", async () => {
    const missing = path.join("/nonexistent", "nope.md");
    await expect(loadPrompt(missing)).rejects.toThrow(/prompt/i);
  });
});
