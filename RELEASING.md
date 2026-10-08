# Releasing

The three packages are published to npm under the public `@repomem` scope:

| Package           | CLI command   | Depends on      |
|-------------------|---------------|-----------------|
| `@repomem/core`   | —             | —               |
| `@repomem/memory` | `repomem`     | `@repomem/core` |
| `@repomem/map`    | `repomem-map` | `@repomem/core` |

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

1. Decide the new version. All three packages are versioned together; keep them
   in lock-step unless there is a reason not to.
2. Bump `"version"` in the three `package.json` files
   (`packages/core`, `packages/memory`, `packages/map`). If `memory` or `map`
   should require the new `core`, also bump the `@repomem/core` dependency range
   in their `dependencies`.
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
   git commit -m "release: v0.1.0"
   ```
5. Tag and push:
   ```bash
   git tag v0.1.0
   git push origin main --follow-tags
   ```
6. Watch the **Publish** workflow in GitHub Actions. On success the three
   packages appear on npm with a green **Provenance** badge.

## Notes & gotchas

- **npm never lets you republish an existing version.** If a publish fails
  mid-way (e.g. `core` published but `memory` failed), fix the problem and bump
  to a new patch version — you cannot re-push the same number.
- **Dependency order matters.** `memory` and `map` depend on `core`, so `core`
  is published first. The workflow enforces this.
- **Verify the install** from another repo after a release:
  ```bash
  npm install @repomem/memory @repomem/map
  npx repomem --help
  npx repomem-map --help
  ```
  Both should resolve `@repomem/core` transitively from the registry.
- **Subsequent releases are tokenless.** Once trusted publishing is configured
  per package, pushing a `v*` tag runs the workflow with no secret. If the
  workflow ever fails with a 403, re-check the trusted-publisher config
  (repo name, workflow filename) on each package.
