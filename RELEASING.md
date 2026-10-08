# Releasing

The three packages are published to npm under the public `@repomem` scope:

| Package           | CLI command   | Depends on      |
|-------------------|---------------|-----------------|
| `@repomem/core`   | —             | —               |
| `@repomem/memory` | `repomem`     | `@repomem/core` |
| `@repomem/map`    | `repomem-map` | `@repomem/core` |

Publishing is automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
triggered by pushing a git tag that matches `v*` (or run manually via
*Actions → Publish → Run workflow*). The workflow installs, typechecks, builds,
tests, and then publishes **in dependency order** (`core` → `memory` → `map`)
with `--access public --provenance`.

## One-time setup (maintainer)

1. **npm org** — create the free `repomem` org (public packages are free):
   https://www.npmjs.com/org/create
2. **Account** — npm account with a verified email and 2FA set to
   *Authorization and Publishing*.
3. **Automation token** — npm → *Access Tokens* → generate an **Automation**
   token (it bypasses the interactive 2FA prompt that CI cannot answer).
4. **GitHub secret** — add the token as a repository secret named exactly
   `NPM_TOKEN`: repo → *Settings → Secrets and variables → Actions → Secrets →
   New repository secret*.

Provenance needs no extra secret: the workflow already requests
`id-token: write`, and GitHub's OIDC + Sigstore sign the attestation. It only
works for public packages published from CI, which is this setup.

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
- **Pre-existing `0.1` tag on GitHub.** A `0.1` tag may already exist from
  before the scope migration. It does not affect npm (nothing was ever
  published). If you want `v0.1.0` to be the real release tag, you can delete
  and recreate it — this is a **destructive git operation**, do it deliberately:
  ```bash
  # destructive: rewrites a remote tag
  git tag -d 0.1
  git push origin :refs/tags/0.1
  git tag v0.1.0
  git push origin v0.1.0
  ```
