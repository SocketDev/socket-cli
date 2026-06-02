# Local git config invariants

A fleet repo's local `.git/config` carries **per-clone** state. Identity, signing keys, and core invariants like `core.bare` live in the **global** git config (and in `~/.gitconfig`); the local config exists for per-repo overrides like `branch.<name>.remote` and `lfs.url`.

## What's banned

These keys must never appear in a fleet repo's local `.git/config`:

| Key                | Why it's banned                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.bare`        | `bare = true` turns the work tree into a bare repo. Every `git status` / `git commit` / `git rev-parse --is-inside-work-tree` then fails with "must be run in a work tree". The repo becomes unusable until manually cleaned up. |
| `user.email`       | Overrides the global identity. Commits sign with the global GPG key but author with the local email — GitHub rejects the push for "Found N violations: <sha>" verified-signature check. |
| `user.name`        | Same shape — the commit author won't match the global GitHub identity.                                                                              |
| `user.signingkey`  | Pinning a key locally drifts from the canonical global key. If the local key is wrong (or stale after rotation), every commit is unsigned to GitHub. |
| `commit.gpgsign`   | Disabling signing locally bypasses the fleet rule. Pre-commit hook catches it for `main`/`master` but the local config has clobbered the global preference. |

## How the guard fires

`PreToolUse(Bash + Edit/Write)` blocker triggered by either path:

1. **Bash** — `git config <key> <value>` (no `--global` / `--system` / `--worktree` qualifier) that touches a banned key:
   ```
   git config core.bare true
   git config user.email test@example.com
   git config commit.gpgsign false
   ```
2. **Edit / Write** — direct writes to `.git/config` (any path matching `**/.git/config`) where the new content contains one of the banned `[section] key = value` shapes.

`git config --global <key>` is **always allowed** — global config is the canonical home for identity / signing settings.

## Bypass

Single-use bypass for genuine operator scenarios (initial signing setup on a fresh checkout, signing-key rotation, manual cleanup after a `bare = true` incident):

```
Allow git-config-write bypass
```

Type the phrase verbatim in a recent user turn. The guard rescans on every Bash/Edit/Write call, so the bypass applies to exactly the next action that would have been blocked.

## SessionStart corruption probe

Same hook runs at SessionStart and walks fleet repos under `~/projects/` looking for already-corrupted state:

- `[core] bare = true` in any local `.git/config`
- `[user] email = test@*` or `email = *@example.com` (test-fixture leaks)
- `[user] name = Test User`
- Local `commit.gpgsign = false`

Findings are emitted to stderr at SessionStart (informational, never blocks). Cleanup is operator-driven: edit `.git/config` manually, or `git config --unset <key>` per finding. Per the fleet's "never update the git config" rule, no auto-fix.

## Why this exists

**2026-06-02**: A fleet repo's `.git/config` was found with `bare = true` + `user.email = test@example.com` from a prior session. Every git command failed with "must be run in a work tree" for 3+ turns until the user manually edited the config back. Root cause traced to a test fixture or sibling-session leak that ran `git init --bare` or similar inside the working tree.

The blast radius is high: a single bad config write knocks out an entire repo for the rest of the session.

## Companion rules

- [`docs/claude.md/fleet/commit-signing.md`](commit-signing.md) — the signing topology this guards
- [`docs/claude.md/fleet/parallel-claude-sessions.md`](parallel-claude-sessions.md) — broader parallel-agent hygiene
- `.claude/hooks/fleet/no-revert-guard/` — bypass-phrase pattern this hook reuses
</content>
