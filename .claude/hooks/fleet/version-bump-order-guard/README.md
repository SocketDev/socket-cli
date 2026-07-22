# version-bump-order-guard

PreToolUse hook that gates the version-bump flow at two points: the bump **commit** and the **tag**. It blocks either when the tree fails the fast pre-release gate, and blocks a tag placed on a non-bump commit. Enforces steps 1, 3, and 4 of CLAUDE.md's "Version bumps" rule.

## What it catches

- A bump **commit** (`git commit -m "chore: bump version to X.Y.Z"`, also `--message=…`) whose tree fails `pnpm run lint --all` or has open `pnpm audit` advisories. The bump commit is where a still-broken tree lands; gating it stops a bump from being committed onto code CI then rejects on push.
- `git tag v1.2.3` (or `git tag -a v…`, `git tag -s v…`) when the most-recent commit subject doesn't match `chore: bump version to X.Y.Z` or `chore(scope): release X.Y.Z`.
- A version tag whose tree fails `pnpm run lint --all`, the exact command CI's Check job runs — accumulated lint debt that CI will reject.
- A version tag whose tree has open `pnpm audit` advisories — a release carrying known-vulnerable dependencies.

## Why

The bump commit must be the LAST commit on the release. Tagging on a non-bump commit produces a broken release: `git describe` lies, bisecting past the tag lands on a different state, and the changelog drifts from the artifact.

The gate half front-runs the two pre-release checks cheap enough to run synchronously. **Why:** when a cascade escalates lint rules to `error` without bringing the code into compliance, the accumulated lint errors and open advisories slip past the local steps and only surface when CI's Check job fails post-tag. By then the broken release is already cut. The slow half of the gate (`pnpm run check --all` — typecheck, unit tests, coverage) stays in CI.

## Bypass

- Type `Allow version-bump-order bypass` in a recent user message (also accepts `Allow version bump order bypass` / `Allow versionbumporder bypass`), or
- Set `SOCKET_VERSION_BUMP_SKIP_GATE=1` (gate half only — when the gate is being run out-of-band but ordering is fine).

## Test

```sh
pnpm test
```
