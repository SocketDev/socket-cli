# git-config-write-guard

PreToolUse + SessionStart hook that prevents identity / signing / topology keys from being written to a fleet repo's local `.git/config`, and surfaces existing corruption at session start.

## What it catches

### PreToolUse (Bash)

`git config <key> <value>` (no `--global` / `--system` / `--worktree` scope qualifier) where `<key>` is:

- `core.bare`
- `user.email`
- `user.name`
- `user.signingkey`
- `commit.gpgsign`

### PreToolUse (Edit / Write / MultiEdit)

Direct writes to `**/.git/config` whose new content has any banned `[section] key = value` shape.

### SessionStart

Scans every fleet repo under `~/projects/` for an already-corrupted `.git/config`:

- `[core] bare = true` (work tree treated as bare repo)
- `user.email = test@example.com` (test-fixture leak)
- `user.name = "Test User"` (test-fixture identity leak)
- `commit.gpgsign = false` (overrides global signing preference)

Findings are surfaced via stdout at SessionStart (informational only — never blocks). Per the fleet's "never update the git config" rule, no auto-fix.

## Bypass

```
Allow git-config-write bypass
```

Single-use; type in a recent user turn for genuine operator scenarios (initial signing setup on a fresh checkout, signing-key rotation, manual cleanup after a `bare = true` incident).

## Full spec

[`docs/claude.md/fleet/git-config-write-guard.md`](../../../docs/claude.md/fleet/git-config-write-guard.md)

## Test

```sh
pnpm test
```
