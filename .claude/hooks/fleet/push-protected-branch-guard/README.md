# push-protected-branch-guard

PreToolUse(Bash) hook that blocks a `git push` which would update a protected remote branch (`main` / `master`) when the user only asked to commit locally.

## Why

"Land", "commit", and "surgically commit" all mean a LOCAL commit — they never mean push. A real incident had an agent push to a shared repo's `origin/main` while the user had only asked it to commit locally. A push to a shared trunk is irreversible; this guard is the agent-side block that stops it.

A sub-agent cannot authorize the push itself: the bypass scanner reads only genuine user-role transcript text, so a sub-agent reading its own prompt back can never fake the authorization. Only an explicit "push" instruction in a real user turn lifts the block.

## What it catches

Deny — a write to a protected branch:

- `git push origin main`
- `git push origin HEAD:main`
- `git push origin <sha>:refs/heads/main`
- `git push --force origin main` / `git push --force-with-lease origin master`
- `git push origin :main` — deleting a protected branch
- a bare `git push` on a checkout whose current branch is `main` / `master`

Allow — the PR / feature-branch flow must never break:

- `git push fork perf/foo`
- `git push origin feature-x`
- `git push -u fork branch:branch`
- `git push origin v1.0` / `git push origin tag v1.0` — a tag, not a branch
- `git commit` / `git fetch` / any non-push git command

## How it works

`_shared/push-refspec.mts` tokenizes the command with the fleet shell parser, finds each `git push` segment, and reads the DESTINATION ref out of every refspec — stripping a leading `+`, taking the part after the last `:`, and normalizing `refs/heads/main` → `main`. A bare push (no refspec) or a `HEAD` destination resolves the repo's current branch. The push is denied when any destination is `main` or `master`.

The guard fails open on any parse / resolution ambiguity: a missed block is one push the operator can force-revert; a false block wedges a valid feature-branch workflow.

## How to bypass

Type one of these verbatim in a recent user message, then retry:

- `Allow push to main` / `Allow push to master`
- `Allow push-to-protected bypass` / `Allow protected-push bypass`

The phrase is normalized (case / dash / whitespace folded), so `allow push to main` counts too.

## Test

```sh
pnpm test
```
