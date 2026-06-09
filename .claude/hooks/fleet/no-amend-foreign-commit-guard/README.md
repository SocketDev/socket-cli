# no-amend-foreign-commit-guard

**Type:** PreToolUse(Bash) hook (BLOCK — exit 2).

## Trigger

Blocks `git commit --amend` when **both** hold for the target repo's HEAD:

1. HEAD is **ahead of the remote default branch** (`origin/<default>..HEAD ≥ 1`) — the amend rewrites local-only, unpushed history; and
2. HEAD's commit timestamp is **older than ~10 min** — it isn't a commit you authored this turn.

Together those mean you're amending an unpushed commit a **parallel session** authored. The amend would fold your change + message into their feature commit, with no remote copy to recover from.

Allowed (not blocked): amending the commit you made this turn (fresh tip, within the threshold), and amending a commit that's already pushed (HEAD == remote tip — that's a force-push concern handled by other guards).

Detection reads git state from the repo (`extractGitCwd`); the block decision is the pure `shouldBlockAmend(info, nowMs)`.

## Why

A session amended a parallel session's unpushed feature commit while landing an unrelated change — it swept the change into the wrong commit and rewrote its message, costing a reflog recovery. A `git status` HEAD-check before amending catches it; this enforces that check at the Bash layer so no amend path skips it.

## Bypass

The rare intentional amend of an older own-commit:

```
Allow amend-foreign bypass
```

Fails open on a malformed payload or unreadable git state.
