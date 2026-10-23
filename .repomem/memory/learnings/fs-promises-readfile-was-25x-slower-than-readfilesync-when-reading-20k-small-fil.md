---
type: learning
title: >-
  fs.promises.readFile was ~25x slower than readFileSync when reading 20k small
  files in WSL2
status: accepted
date: '2026-10-23'
scope: project
tags:
  - map
  - performance
  - wsl2
  - node
related_paths:
  - packages/map/src/pending.ts
  - packages/map/src/deps/graph.ts
---
Measured on a synthetic 20,000-file repo (3.4 KB each, WSL2, 4 cores, Node 22): sequential `fs.promises.readFile` 12.3 s, `fs.readFileSync` 0.46 s, native `cat` of all files 1.1 s. Bounded parallelism (32 concurrent) barely helped (8.9 s). Seen in a one-off script, not reproduced elsewhere, so treat as environment-dependent. It is why walking an entire repo per `request_summaries` call was costly even before the gitignore problem; the fix reduced the number of files touched rather than the per-file cost. If per-file cost matters again, benchmark sync reads or batching before assuming async is faster.
