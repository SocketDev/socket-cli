# version-bump-order-guard

PreToolUse hook that blocks `git tag vX.Y.Z` when HEAD isn't a bump commit. Enforces step 3-4 of CLAUDE.md's "Version bumps" rule.

## What it catches

- `git tag v1.2.3` (or `git tag -a v…`, `git tag -s v…`) when the most-recent commit subject doesn't match `chore: bump version to X.Y.Z` or `chore(scope): release X.Y.Z`.

## Why

The bump commit must be the LAST commit on the release. Tagging on a non-bump commit produces a broken release: `git describe` lies, bisecting past the tag lands on a different state, and the changelog drifts from the artifact.

## Bypass

- Type `Allow version-bump-order bypass` in a recent user message (also accepts `Allow version bump order bypass` / `Allow versionbumporder bypass`), or
- Set `SOCKET_VERSION_BUMP_ORDER_GUARD_DISABLED=1`.

## Test

```sh
pnpm test
```
