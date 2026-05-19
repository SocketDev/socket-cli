# pr-vs-push-default-reminder

PreToolUse Bash hook (reminder, NOT a block) that fires on `gh pr create`
when the current branch is `main` / `master` AND no recent user turn
contains an explicit PR directive.

## Why

Per CLAUDE.md "Push policy: push, fall back to PR" — direct `git push`
is the fleet default. The PR-fallback is for the cases where the push
is rejected (branch protection, conflicts, identity rejection).

Past pattern: agents opened PRs speculatively when a direct push would
have worked. The user then has to close each PR. This hook gives the
agent a nudge to try the direct push first.

## PR directive patterns

Any of the following in a recent user turn passes the check:

- "open a PR" / "open the PR" / "open a pr"
- "PR this" / "pr this"
- "make a PR" / "make the PR"
- "create a PR" / "send a PR"
- "pull request"

## Not a block

Reminder-only. The agent can still proceed with `gh pr create` if it's
the correct action (e.g. the push truly will be rejected). The
reminder just surfaces the alternative.

## Skipped scenarios

- Current branch is NOT main/master (feature branches always PR).
- The PR command has the directive in a recent user turn.
- The transcript can't be read (failed gracefully).
