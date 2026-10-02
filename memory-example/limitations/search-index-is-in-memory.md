---
type: limitation
title: The search index is held in memory and rebuilt on change
status: accepted
date: 2026-02-01
tags:
  - search
  - performance
related_paths:
  - "src/search.ts"
last_verified: 2026-02-01
---

The index is not persisted. For very large memory folders (tens of thousands
of entries) the rebuild cost on startup may become noticeable.

For the expected scale (hundreds to low thousands of entries) this is well
within acceptable latency, so persistence is intentionally out of scope.
