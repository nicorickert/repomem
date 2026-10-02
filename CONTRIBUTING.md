# Contributing to repomem

## Branching model

A lightweight Gitflow with two long-lived branches:

- **`main`** — release branch. Always deployable/publishable. Only updated by
  promoting `develop` (via a release PR or merge). Tags are cut here.
- **`develop`** — integration branch. All day-to-day work lands here first.

Short-lived working branches are created off `develop` and merged back into
`develop` through a pull request:

| Prefix      | Purpose                                   |
|-------------|-------------------------------------------|
| `feature/*` | New functionality                         |
| `fix/*`     | Bug fixes                                 |
| `chore/*`   | Tooling, deps, scaffolding, housekeeping  |
| `docs/*`    | Documentation-only changes                |
| `refactor/*`| Code changes with no behaviour change     |
| `test/*`    | Adding or reworking tests                 |

Flow:

```
feature/* ──PR──▶ develop ──promote (PR)──▶ main ──tag──▶ release
```

Rules:
- Never commit directly to `main`.
- Prefer small, reviewable PRs. AI-authored changes are reviewed by a human
  before merge — the same principle repomem applies to memory entries.
- Branches are deleted after merge.

## Commit messages — Conventional Commits

Format:

```
type(scope): subject

[optional body]

[optional footer(s)]
```

- **type**: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`, `perf`
- **scope** (optional): the area touched. Common scopes:
  `schema`, `store`, `search`, `server`, `cli`, `mcp`, `repo`, `deps`
- **subject**: imperative mood, lower case, no trailing period, <= 72 chars
- **breaking changes**: append `!` after the type/scope (e.g. `feat(store)!: ...`)
  and/or add a `BREAKING CHANGE:` footer.

Examples:

```
feat(schema): add zod frontmatter schema with status defaults
fix(store): skip malformed entries instead of throwing
chore(repo): scaffold project structure and tooling
docs(readme): document the propose-then-review workflow
```
