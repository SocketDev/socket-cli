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
- a placeholder `user.email` (`*@example.com`, `agent-ci@…`, any `.example` / `localhost` / `invalid` / `test` domain)
- `user.name = "Test User"` (test-fixture identity leak)
- `commit.gpgsign = false` (overrides global signing preference)

Findings surface via stdout at SessionStart (never blocks). Two AUTO-FIX; the rest report for manual cleanup:

- `core.bare = true` is unset (always wrong for a non-bare checkout).
- a placeholder local `user.email` / `user.name` is unset WHEN a `--global` identity exists to fall back to. A placeholder author email can't be verified against the signing key on GitHub, so a signed push is rejected by `required_signatures`, and the bad value is typically planted outside the tool channel (an agent-CI container entrypoint), so the PreToolUse write-block never sees it. Unsetting the local override lets the signed global identity win. With no global fallback the finding is reported, not unset, so the repo is not left with no author.

## Bypass

```
Allow git-config-write bypass
```

Single-use; type in a recent user turn for genuine operator scenarios (initial signing setup on a fresh checkout, signing-key rotation, manual cleanup after a `bare = true` incident).

## Full spec

[`docs/agents.md/fleet/git-config-write-guard.md`](../../../docs/agents.md/fleet/git-config-write-guard.md)

## Test

```sh
pnpm test
```
