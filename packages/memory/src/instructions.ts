/**
 * instructions.ts — the protocol text sent to every MCP client on `initialize`.
 *
 * Clients that surface server `instructions` put this in the model's context,
 * so even a generic agent (one that never loaded the repomem skills, hooks or
 * agent config) is told when to call the memory tools. It is deliberately short
 * and imperative; the longer rationale lives in the `repomem-memory` and
 * `repomem-distill` skills, which must stay consistent with this text.
 *
 * Every tool name mentioned here is checked against the registered tools in
 * test/instructions.test.ts, so the text cannot drift from the real API.
 */

/** The exact command to validate entries. Always scoped: never an unscoped `npx repomem`. */
export const VALIDATE_COMMAND = "npx --package @repomem/memory repomem-memory validate";

export const MEMORY_INSTRUCTIONS = `\
repomem-memory is this repository's shared memory (decisions, conventions, limitations, learnings, context), stored as git-versioned markdown in .repomem/memory/. Follow this protocol on every task that changes files.

BEFORE editing:
1. Call memory_for_path once for each file you are about to modify.
2. Call search_memory once per main concept of the task (not one search for the whole task).
3. Call get_memory for anything relevant. If an entry contradicts your plan, tell the user before coding; do not silently override it.
An empty result is a valid answer: say so in one line and continue. It does not mean memory is irrelevant to this repo.

WHILE working: note any non-obvious choice (you picked A over B for a reason a teammate could not guess).

AFTER finishing:
1. Decide explicitly whether anything durable came out of the work (a decision with its rejected alternative, a surprise, a constraint, something you could not verify). If nothing, propose nothing.
2. Call propose_memory once per item. Entries are always created as drafts for human review; never mark one accepted. Set related_paths to globs that include the main source file AND its test or doc. There is no scope parameter: express module scope with related_paths and tags.
3. If your work makes an earlier entry false, pass supersedes on the new entry, or call deprecate_memory. Do not leave contradicting entries live.
4. Run \`${VALIDATE_COMMAND}\` and fix what it reports. If you cannot run it, say so.
`;
