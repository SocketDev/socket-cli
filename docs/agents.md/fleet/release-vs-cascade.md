# Release bundle vs commit cascade

Fleet scaffolding reaches members two ways. The split is deliberate: **the commit
cascade carries only what MUST be version-controlled; everything else rides the
GitHub-release bundle.**

## The two payloads

- **Commit cascade** (`scripts/repo/sync.mts --fleet`) — byte-identical files
  *committed* to every member's git (`IDENTICAL_FILES` + fleet dir-mirrors). Keep
  this **minimal**: only files that cannot be delivered via the release, or that
  must live in version control for git/build tooling to work — lockfiles,
  `.gitignore`, `.npmrc`, `.editorconfig`, `.git-hooks/*` dispatchers, tsconfig,
  `.cargo/config.toml`, and the like.
- **GitHub-release bundle** (`scripts/repo/make-release-bundle.mts`) — a
  downloadable tarball the dep-0 bootstrap fetches + extracts on install. This is
  the **fat** payload: the bulk of the scaffolding, plus regenerable build output
  that has no business in anyone's git history.

Guiding rule: **less in the commit cascade, more in the release.** A file that is
regenerable, large, or per-repo-dynamic belongs in the release (or is rebuilt
locally), never committed to 16 repos.

## Release-only artifacts

Some files sit *inside* a cascaded dir-mirror but must NOT be committed. They are:

1. listed in `RELEASE_ONLY_DIR_MIRROR_FILES`
   (`scripts/repo/sync-scaffolding/dir-mirror-skip.mts`) — the shared skip
   predicate drops them from the dir-mirror **check** and **fix**, so the cascade
   never commits or copies them;
2. gitignored fleet-wide (the `**/.claude/hooks/fleet/_dispatch/*.cjs` block in
   the `.gitignore` fleet-canonical section) — including the wheelhouse's own
   `template/base/` mirror copies;
3. still shipped by `make-release-bundle` — its raw walk of `template/base`
   includes them (it does NOT apply the cascade skip predicate), so they land in
   the release tarball and the bootstrap extracts them.

The current members of the set are the three rolldown-generated hook bundles —
`bundle.cjs` (the plain-require baseline), `excluded-bundle.cjs`, and
`snapshot-bundle.cjs` — ~11 MB of build output that used to be committed to every
repo. Their loaders **fail open** when a bundle is absent, and
`setup:3-hook-snapshot` rebuilds all three, so a member that has cascaded but not
yet fetched the release simply runs with inert (not broken) fast-path hooks until
setup or the release fetch lands.

`dogfood` rebuilds all three (`build-hook-bundle` + `build-hook-snapshot`) and
mirrors them onto `template/base` on every run, so the release always packages
fresh bundles even though they are untracked.

## `.janus/`

`.janus/` (per-repo Janus ticket queue) is gitignored — out of the commit cascade
by construction. A fresh queue is created per-repo by `janus init` at setup /
adoption, not seeded from the release (there is no canonical seed content; the
queue is repo-local and dynamic). See
[`multi-janus-mcp-shim`](multi-janus-mcp-shim.md).
