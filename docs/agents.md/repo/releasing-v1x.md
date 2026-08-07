# Releasing v1.x

The `v1.x` branch ships three npm packages - `socket`, `@socketsecurity/cli`,
and `@socketsecurity/cli-with-sentry` - from one source tree at one shared
version. The publisher is `.github/workflows/npm-publish.yml` **on the `v1.x`
branch**, which is a different pipeline from the one `main` uses for the 2.x
line.

## What an agent may do

- Add or reword bullets under `## [Unreleased]` in `CHANGELOG.md`.
- Prepare the bump commit **after the user names the version**: strip the
  `-prerelease` suffix from `package.json` and promote `## [Unreleased]` to
  `## [X.Y.Z](https://github.com/SocketDev/socket-cli/releases/tag/vX.Y.Z) - YYYY-MM-DD`.
- Open the PR against `v1.x` and drive the three required `e2e-tests` checks
  (Node 20, 22, 24) to green. Commits must be signed.
- Restore the next hint after a release lands: set `package.json` to
  `X.Y.(Z+1)-prerelease` and put an empty `## [Unreleased]` section back.
- Read run logs and explain which guard tripped.

## What an agent must never do

- **Name the version.** The user picks `X.Y.Z`; a `--dry-run` is fine, but an
  agent proposing the number is how a release lands somewhere nobody intended.
- **Dispatch a real run** (`dry-run=false`). Preparing or explaining one is
  fine; the dispatch that can reach the registry is a human action.
- **Approve a stage.** Promotion needs browser 2FA. Never request a one-time
  code and never emit one.
- **Reuse a burned version**, or retag to work around a tag collision.

## The cycle

Between releases the tree carries the next version as a hint
(`X.Y.Z-prerelease`) and user-facing notes accrue under `## [Unreleased]`. The
bump commit turns the hint into the release. Dispatch the workflow with
`dry-run=true` first. It builds, packs, and smoke-tests all three packages
while uploading nothing. Then dispatch with `dry-run=false` and
`dist-tag=latest`. The run cuts the `vX.Y.Z` tag and the immutable GitHub
release (both belong to the `socket` package, one of each per run), then stages
all three packages. A human promotes them with `pnpm stage approve`.

## Which branch owns `latest`

`v1.x` does. It is the line customers consume, so it owns the `latest`
dist-tag, which is the pointer an untagged install resolves to. The default
branch carries the 2.x PRERELEASE line and is refused `latest`; it publishes
under a prerelease tag (`next`, `beta`, `canary`, `rc`).

This is declared rather than hard-coded. `release.latestDistTagBranch` in
`.config/repo/socket-wheelhouse.json` is set to `v1.x`, and the fleet's
`npm-publish.yml` guard reads it, defaulting to the repo's default branch for
every other member.

## Two jobs, one credential boundary

`verify` binds no environment and mints no OIDC token, so nothing it runs -
install scripts, build tooling, third-party actions - can reach a publish
credential. `publish` holds the credential and does almost nothing: no
checkout, no install, no build. It publishes the exact bytes `verify` packed
and proved, so what ships is what was tested.

## The burn rule

The tag and release are cut BEFORE the uploads so the provenance attestation
binds markers that already exist. The trade: a failure after the tag exists
burns that version number. Move the hint to the next patch and go again - the
tag step hard-fails on a re-tag by design rather than silently moving a tag
someone may already have pulled. Re-running the exact same commit is safe: the
tag and release steps are idempotent and the stage upload retries.

Every other guard runs before the markers, so tripping one costs nothing: the
`latest`-off-default-branch refusal, the refusal to publish a `-prerelease`
hint version, the refusal to republish a version the registry already carries,
and the check that the pinned pnpm can resolve `pnpm stage`.
