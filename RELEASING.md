# Releasing

The four packages are published to npm under the public `@repomem` scope:

| Package           | CLI command      | Depends on                                 |
|-------------------|------------------|--------------------------------------------|
| `@repomem/core`   | —                | —                                          |
| `@repomem/memory` | `repomem-memory` | `@repomem/core`                            |
| `@repomem/map`    | `repomem-map`    | `@repomem/core`                            |
| `@repomem/cli`    | `repomem`        | `@repomem/core`, `@repomem/memory`, `@repomem/map` |

> **Dependency order for publishing:** `core` → `memory` → `map` → `cli`.
> The `cli` installer depends on `memory` and `map`, so it is published last.

Publishing is **tokenless**: it uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC) from GitHub Actions, so there is **no `NPM_TOKEN` secret**. Releases are
automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
triggered by pushing a git tag that matches `v*` (or run manually via
*Actions → Publish → Run workflow*). The workflow installs, typechecks, builds,
tests, and then publishes **in dependency order** (`core` → `memory` → `map`)
with `--access public`. Provenance is attached automatically.

## One-time setup (maintainer)

npm's trusted publishing has a chicken-and-egg limitation: **a package must
already exist before you can configure a trusted publisher for it.** So the very
first release is published manually; everything after that is tokenless CI.

### 1. Account and org

1. **npm org** — create the free `repomem` org (public packages are free):
   https://www.npmjs.com/org/create
2. **Account** — npm account with a verified email and 2FA enabled.

### 2. Bootstrap: publish `0.1.0` manually, once

From a clean checkout of `main` at the release commit:

```bash
npm ci
npm run build
npm test

npm login            # interactive, answers your 2FA prompt

# dependency order: core -> memory -> map
npm publish -w @repomem/core   --access public --provenance
npm publish -w @repomem/memory --access public --provenance
npm publish -w @repomem/map    --access public --provenance
```

Requires npm >= 11.5.1 locally for provenance from a non-CI environment
(`npm install -g npm@latest`).

### 3. Configure trusted publishing (now that the packages exist)

For **each** of the three packages, on npmjs.com:

> Package → *Settings* → *Trusted Publisher* → **GitHub Actions**, then set:
> - Organization / user: `nicorickert`
> - Repository: `repomem`
> - Workflow filename: `publish.yml`

After this, CI can publish without any token. There is no `NPM_TOKEN` secret to
create; if one exists from an earlier attempt, delete it
(repo → *Settings → Secrets and variables → Actions*).

The workflow already requests `id-token: write` and upgrades npm to a version
that supports trusted publishing.

## Cutting a release

Releases are **per-package**. The publish workflow checks each package's
version against npm and publishes **only the ones whose version is new**;
packages whose version already exists are skipped. So you bump just the
package(s) you changed.

1. Decide which packages changed and their new versions. You can bump a single
   package (e.g. just `@repomem/memory`) or several together.
2. Bump `"version"` in the `package.json` of each changed package
   (`packages/core`, `packages/memory`, `packages/map`, `packages/installer`).
   If `memory`, `map`, or the `cli` installer should require a newer `core`,
   also bump the `@repomem/core` dependency range in their `dependencies`.
   - **Dependency order matters when several change at once.** The workflow
     publishes in the order `core → memory → map → cli`, so a dependency is
     always published before its dependents.
   - You do **not** need to bump unchanged packages; they are skipped.
3. Run the full suite locally to be safe:
   ```bash
   npm ci
   npm run typecheck
   npm run build
   npm test
   ```
4. Commit the version bump:
   ```bash
   git add -A
   git commit -m "release: v0.1.1"
   ```
5. Tag and push:
   ```bash
   git tag v0.1.1
   git push origin main --follow-tags
   ```
6. Watch the **Publish** workflow in GitHub Actions. It publishes only the
   packages whose version is new (the rest are skipped). On success the newly
   published packages appear on npm with a green **Provenance** badge.

## Notes & gotchas

- **The tag is just a trigger; versions come from `package.json`.** The `v*`
  tag only starts the workflow — what gets published is decided per package by
  comparing each `package.json` version against npm. Use any tag scheme you
  like (e.g. the highest version in the release).
- **npm never lets you republish an existing version.** The workflow skips any
  package whose version already exists, so a partial failure is safe to re-run
  after bumping the package that failed to a new patch version.
- **Dependency order matters.** `memory`, `map`, and the `cli` installer depend
  on `core`, so `core` is published first. The workflow enforces the order
  `core → memory → map → cli`.
- **Verify the install** from another repo after a release:
  ```bash
  npx @repomem/cli --help
  npx --package @repomem/memory repomem-memory --help
  npx --package @repomem/map    repomem-map    --help
  ```
  All should resolve `@repomem/core` transitively from the registry.
- **Subsequent releases are tokenless.** Once trusted publishing is configured
  per package, pushing a `v*` tag runs the workflow with no secret. If the
  workflow ever fails with a 403, re-check the trusted-publisher config
  (repo name, workflow filename) on each package.
