---
name: repomem-map-structure
description: Mandatory protocol for the repository's structure map (per-file summaries plus an import/dependency graph). Use before changing any shared model, interface, public function signature or module that other files import (blast radius), when locating where a concept lives in unfamiliar code, and after finishing to refresh the summaries of the files you changed. The dependency graph works even when no summaries exist.
---

# repomem-map — the repository's structure map

repomem-map answers *what* and *where*: what each file is about, where a concept
lives, and who depends on whom. It keeps per-file summaries plus a dependency
graph derived from imports, served over MCP.

`grep` finds text; the map finds **structure**. Use it for the things grep does
badly: transitive dependents and "what is this file for". The graph is brought
up to date as files change during the session, so a file you just created or
edited is reflected on your next query.

## Protocol

**Before changing a shared symbol** (a domain model, an interface, a public
function signature, a constructor, anything other files import):

1. Call `get_dependents` on the file that defines it with `depth: 1`. That is
   the direct blast radius; drop `depth` for the transitive closure when the
   change is risky. This is the list of files you must re-check, tests included.
2. Call `get_dependencies` when you need to know what a file relies on before
   moving or splitting it.
3. State the blast radius (count and the notable files) when you justify the
   change.

**Before editing unfamiliar code**: call `find_code` with the concept, then
`get_module` on the best hits to read the summary and its `stale` flag.

**After finishing**: refresh the summaries of the files you created or changed
(see "Keeping summaries fresh").

## Tools

- `get_dependents(path, depth?)` — files that import `path` (blast radius),
  with hop distance. Works without any summaries.
- `get_dependencies(path, depth?)` — files `path` imports, with hop distance.
  Works without any summaries.
- `find_code(query)` — search summaries, search terms and paths. It needs
  summaries: an empty result on a young map means "no summaries yet", not "no
  such code". Fall back to `grep`.
- `get_module(path)` — full record for one path, with its direct dependencies
  and dependents. `stale: true` means the file changed since the summary was
  written, so treat the summary as a hint only.
- `request_summaries(limit?)` — lists files whose summary is missing or stale,
  with the summarization prompt and each file's `hash`.
- `save_summary(path, summary, search_terms, hash, model?)` — persists a
  summary. The `hash` MUST be the one returned by `request_summaries` for that
  file; it is re-validated against the file's current content.
- `open_graph(port?)` — starts a local web viewer of the graph and returns its
  URL. It is a viewer only and does not answer queries; use `get_dependents` and
  `get_dependencies` for that.

## Keeping summaries fresh

1. Call `request_summaries` after your changes and handle only the files you
   touched; the list may include unrelated ones, leave those.
2. Read each file and write a 2-4 sentence summary of what it is FOR and which
   concepts it owns (not a line-by-line description), plus `search_terms` a
   teammate would type, using the vocabulary of the codebase (including terms in
   other languages if the code mixes them).
3. Call `save_summary` with the hash from step 1. The summary is searchable
   immediately. Summaries are committed to the repo; review them like any other
   change.

## Caveats

- The graph is built from static imports only. Dynamic wiring (dependency
  injection containers, registries, plugin loading, string-based imports) does
  not appear in `get_dependents`. When you change a constructor, interface or
  registered component, also `grep` for the symbol name.
- A result of `found: false` means the path is not a known source file
  (unsupported language, ignored directory or a typo), not that nothing depends
  on it.
