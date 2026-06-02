# pr-vs-push-default-reminder

PreToolUse Bash hook (reminder, NOT a block) that nudges toward a direct
push when an agent is about to open a PR — or push a feature branch as
the precursor to one — without an explicit PR directive in a recent
user turn.

## Why

Per CLAUDE.md "Push policy: push, fall back to PR" — direct `git push`
is the fleet default. The PR-fallback is for the cases where the push
is rejected (branch protection, conflicts, identity rejection).

Past pattern: agents opened PRs speculatively when a direct push would
have worked. The user then has to close each PR. A sharper variant bit a
session 2026-06-02: the agent ASSUMED a repo was PR-only from its commit
history + GitHub's "create a PR" hint, cut a feature branch, and nearly
opened a PR — a direct push to `main` worked immediately. This hook
nudges the agent to try the direct push first and let the server decide.

## What it catches

1. `gh pr create` / `gh pr new` on `main` / `master` (any repo).
2. `gh pr create` on a FEATURE branch in a FLEET repo — suggests
   `git push origin <branch>:<default>` instead of a PR.
3. `git push origin <feature-branch>` (as a branch, not `…:<default>`) in
   a FLEET repo — the earlier step where unnecessary PR-flow begins.

Detection is **AST-based** (the shell-quote-backed `shell-command.mts`
parser, not regex), so `&&` chains, quoting, `$(…)`, and a literal
`"git push"` inside a `grep` string are all handled correctly.

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

- A feature branch in a NON-fleet repo (PR-from-branch is the right
  default outside the fleet, e.g. firewall).
- `gh pr create --base <non-default>` — a deliberate stacked/targeted PR.
- An open PR already exists for the branch (re-running is idempotent).
- A `git push` whose refspec already targets the default branch
  (`<branch>:main`) — that IS the direct push.
- A recent user turn contains an explicit PR directive.
- The transcript / origin can't be read (fails open, no reminder).

When the transcript shows a push to the default branch already happened
this session, the `gh pr create` reminder adds a "likely confusion" note.
