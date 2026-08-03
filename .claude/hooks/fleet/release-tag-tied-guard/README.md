# release-tag-tied-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2).

**Trigger:** a Bash command running `gh release create <ref> …`. Detected by
AST-parsing the command (`commandsFor`), not a raw regex, so a quoted
`gh release create` inside another command's string isn't a false trigger.

**Decision:**
- ALLOW (exit 0) when `<ref>` is an existing tag — local
  (`git rev-parse --verify --quiet refs/tags/<ref>`) or remote
  (`git ls-remote --tags origin <ref>`) — `--target` is absent, AND the
  publish-before-release gate passes (below). This is the legitimate
  backfill: `gh release create v0.0.18 --verify-tag …`.
- BLOCK when the tag does not exist (gh would create it on the fly = an
  arbitrary, un-reviewed tag) or when `--target` is present (gh would create
  the tag from that branch/sha).
- BLOCK (publish-before-release gate) when the repo publishes to a registry
  (non-private `package.json` name, else a `Cargo.toml [package]`), the ref
  names a semver version, and that version is NOT live on the registry
  (`npm view name@version`, or the crates.io sparse index). The tag +
  immutable GH release are the FINAL markers of a release — a STAGED package
  is not published, and staging may never be approved (the v6.2.0 near-miss:
  an immutable release with no artifact). The message redirects to the
  pipeline (`publish-pipeline.mts --approve` / `cargo-publish.mts --approve`),
  which cuts the tag + release LAST behind its own liveness gate.
  Registry-less repos and non-semver refs skip this gate. An UNVERIFIABLE
  probe (offline, missing tool) blocks — this rail errs strict; the bypass
  phrase covers genuine exceptions.

**Why:** a GitHub release is always tied to a git tag. `settings.json` moves
`Bash(gh release create:*)` from `deny` to `allow` so tag-backfills run without
a prompt; this guard is the rail that keeps "allow" from meaning "create any
release at any ref". Pair: `immutable-release-guard` checks the 3-step draft→upload→
publish shape, and `version-bump-order-guard` checks the tag sits on a bump commit.

**Fix the message gives:** push the tag first, then create the release for it —
`git tag vX.Y.Z <commit> && git push origin vX.Y.Z`, then
`gh release create vX.Y.Z --verify-tag …`.

**Bypass:** `Allow arbitrary-release bypass` typed verbatim in a recent user
turn.

**Fails open** on parse / payload / git errors (exit 0) — a guard bug must not
wedge every release command.
