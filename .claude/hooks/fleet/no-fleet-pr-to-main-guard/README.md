# no-fleet-pr-to-main-guard

PreToolUse Bash hook (blocking, exit 2) that refuses `gh pr create` /
`gh pr new` in a FLEET repo when the PR's base is the default branch and the
current gh viewer's permission on the target repo is ADMIN.

## Why

The fleet lands work by pushing the default branch directly. A PR is the
fallback for a contributor without push rights, never the admin path: a fleet
PR goes stale within minutes against a fast-moving trunk, collects unrelated
cascade commits, and gets hand-merged later anyway. The nudge sibling
`pr-vs-push-default-nudge` reminds; this guard refuses. The reminder alone
still let a fleet PR open, go stale behind a directory move on main, and need
a hand-resolved conflict landing.

## What it catches

- `gh pr create` in a fleet-roster repo (origin slug, or an explicit
  `--repo`/`-R` value) whose base is the default branch (no `--base`, or
  `--base` naming the resolved default), while `gh repo view --json
  viewerPermission` answers `ADMIN`.

Detection of `gh pr create` is AST-based via the shared `gh-pr-command.mts`
parser, never regex. The fleet-membership read runs first, so the network
permission probe only fires for fleet repos.

## Skipped scenarios (never over-block)

- Non-fleet repos: a PR is the right default outside the fleet.
- Stacked PRs (`--base <non-default>`).
- Non-admin viewers, and an UNREADABLE permission (gh missing,
  unauthenticated, or timing out fails open; the nudge still fires).
- An explicit PR directive from the user in recent turns ("open a PR",
  "pull request", ...): the owner's explicit ask wins.

## Bypass

Type `Allow fleet-pr-to-main bypass` in a recent message.

## Exit codes

- `2`: blocked, fleet repo + default-branch base + ADMIN viewer.
- `0`: allowed (any skipped scenario, not a `gh pr create`, or the bypass
  phrase is present).
