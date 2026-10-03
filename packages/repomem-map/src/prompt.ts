/**
 * prompt.ts — load the summarization prompt from Markdown at runtime.
 *
 * The prompt is a versioned, editable file (`prompts/summary.md`) that ships
 * next to the compiled output, mirroring how the core ships `templates/`.
 * Keeping it as Markdown lets it be reviewed and tuned without code changes.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// `src/prompt.ts` and `dist/prompt.js` both sit one level below `prompts/`.
export const DEFAULT_PROMPT_PATH = path.resolve(here, "..", "prompts", "summary.md");

/** Load the summarization prompt text. Throws a clear error if missing. */
export async function loadPrompt(promptPath: string = DEFAULT_PROMPT_PATH): Promise<string> {
  try {
    return await fs.readFile(promptPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Summary prompt not found at ${promptPath}`);
    }
    throw err;
  }
}
