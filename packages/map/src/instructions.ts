/**
 * instructions.ts — the protocol text repomem-map sends to every MCP client on
 * `initialize`. See the memory package's instructions.ts for the rationale:
 * it reaches generic agents that never loaded the repomem skills or agent
 * config. Keep it consistent with the `repomem-map-structure` skill; every tool
 * named here is checked against the registered tools in test/instructions.test.ts.
 */

export const MAP_INSTRUCTIONS = `\
repomem-map is this repository's structure map: per-file summaries plus a file-to-file dependency graph built from static imports. It answers what each file is for, where a concept lives, and who depends on whom. grep finds text; the map finds structure.

BEFORE changing a shared symbol (a model, an interface, a public function signature, a constructor, anything other files import):
1. Call get_dependents on the file that defines it, with depth 1 for the direct blast radius. Drop depth for the transitive closure when the change is risky. Those are the files, tests included, that you must re-check.
2. Call get_dependencies when you need to know what a file relies on before moving or splitting it.
3. State the blast radius (count and notable files) when you justify the change.

BEFORE editing unfamiliar code: call find_code with the concept, then get_module on the best hits to read the summary and its stale flag. A stale summary is only a hint. An empty find_code result on a young map means no summaries yet, not that the code does not exist: fall back to grep.

The graph follows static imports only. Dynamic wiring (dependency injection, registries, string-based loading) does not appear, so also grep the symbol name when you change a constructor or a registered component.

open_graph only starts a local web viewer and returns its URL. It does not answer queries; use get_dependents and get_dependencies for that.

AFTER finishing: refresh summaries for the files you created or changed. Call request_summaries, handle only the files you touched (leave unrelated ones), read each file, and call save_summary with the hash that request_summaries returned for that file. A summary says what the file is FOR and which concepts it owns, in 2-4 sentences, plus search_terms a teammate would type.
`;
