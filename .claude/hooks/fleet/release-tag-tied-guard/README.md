# release-tag-tied-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2).

**Trigger:** a Bash command running `gh release create <ref> …`. Detected by
AST-parsing the command (`commandsFor`), not a raw regex, so a quoted
`gh release create` inside another command's string isn't a false trigger.

**Decision:**
- ALLOW (exit 0) when `<ref>` is an existing tag — local
  (`git rev-parse --verify --quiet refs/tags/<ref>`) or remote
  (`git ls-remote --tags origin <ref>`) — and `--target` is absent. This is
  the legitimate backfill: `gh release create v0.0.18 --verify-tag …`.
- BLOCK when the tag does not exist (gh would create it on the fly = an
  arbitrary, un-reviewed tag) or when `--target` is present (gh would create
  the tag from that branch/sha).

**Why:** a GitHub release is always tied to a git tag. `settings.json` moves
`Bash(gh release create:*)` from `deny` to `allow` so tag-backfills run without
a prompt; this guard is the rail that keeps "allow" from meaning "create any
release at any ref". Pair: `immutable-release-guard` (the 3-step draft→upload→
publish shape) and `version-bump-order-guard` (the tag sits on a bump commit).

**Fix the message gives:** push the tag first, then create the release for it —
`git tag vX.Y.Z <commit> && git push origin vX.Y.Z`, then
`gh release create vX.Y.Z --verify-tag …`.

**Bypass:** `Allow arbitrary-release bypass` typed verbatim in a recent user
turn.

**Fails open** on parse / payload / git errors (exit 0) — a guard bug must not
wedge every release command.
