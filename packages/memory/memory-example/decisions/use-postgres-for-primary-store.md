---
type: decision
title: Use PostgreSQL as the primary data store
status: accepted
date: 2026-01-15
author: platform-team
tags:
  - database
  - architecture
related_paths:
  - "src/db/**"
  - "migrations/**"
---

We chose PostgreSQL over a document store because the domain is relational
and we rely on transactional guarantees across several tables.

Managed Postgres keeps operational overhead low, and `jsonb` columns cover the
few cases where we need schema-flexible data without adding a second database.
