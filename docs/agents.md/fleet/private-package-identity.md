# Private package identity

A workspace package that never publishes must SAY so in every field a reader
checks. The fleet has thousands of private packages (per-hook dirs, per-rule
dirs, test corpora, bench harnesses), and one dressed as a product is a
standing source of confusion.

## The rule

- **A private package's version is `0.0.0`.** Never anything else. A package
  that never publishes has no release history to be `1.0.0` of, and a version
  that looks real invites release reasoning about something that cannot ship.
  `0.0.0` is the fleet's existing "this is not a release" sentinel, the same
  value a local name reservation carries.
- **A private package's name is unscoped and path-derived**, `<repo>-<dir-path-with-dashes>`:
  `packages/acorn/test` becomes `ultrathink-packages-acorn-test`. An npm scope
  on a private package reads as a published product, squats a namespace the org
  may not own, and hides where the package lives.
- **The repo ROOT is exempt from both.** See below - this is the part that
  looks like a violation and is not.
- **Anything in `release.publishedPackages` is exempt**, because
  `published-packages-are-release-ready` owns it: that check drops the `private`
  flag and syncs the version. Two checks must never both own one package.

## The root exemption

A versioned private root is sanctioned, and carries its own bump test ("a
versioned private root (the stuie shape) is bumped in lockstep too"). It holds
a real version for two reasons:

- **It is the release version for a channel that does not read npm.**
  socket-webext publishes `custom` and its root sits at `1.5.1`, the version the
  VS Code and Open VSX marketplaces receive. node-smol publishes `binary` and its
  root drives the GitHub release. Pinning either to `0.0.0` ships a `0.0.0`
  release.
- **It is the workspace `versionSource`** the lockstep bump reads, so zeroing it
  breaks the bump for every member of that workspace.

`private: true` on a root means "not on npm", which is a different statement
from "not released".

## Enforcement

- `scripts/fleet/check/private-packages-are-unpublishable.mts` gates both
  invariants and rides the release tier of `check --all`. Its `--fix` renames,
  resets versions, and rewrites every dependent manifest, so the workspace still
  resolves; run `pnpm install` afterward to relink.
- `scripts/fleet/check/published-packages-are-release-ready.mts` is the twin:
  every package in `release.publishedPackages` must be non-private and the set
  must carry one version. Its `--fix` moves FORWARD only, raising the set to the
  highest version present, so an already-published version is never reused.

Both read `git ls-files`, so generated build output (wasm-pack's `pkg-node/`, a
napi staging dir) can never enter the set - those manifests carry real names and
are rewritten by their generator on every build.

## Why

The declared-publish list and the manifests drifted apart in ultrathink without
anything noticing: 18 packages declared, 17 of them `private: true`, versions
split across `0.0.0` and `0.1.1`. npm silently SKIPS a private package, so the
release stayed green while the packages never went out, and a consumer
installing the loader would resolve an optional platform dependency that does
not exist. Nothing failed loudly, which is what let it persist.

The naming rule earns its place a different way: it costs a reader time on every
encounter. `@acorn/tests` at `1.0.0` is a test corpus, and anyone meeting that
name in a manifest, a lockfile, or an install tree has to open the file to learn
it never ships.
