# prefer-rebase-over-revert-guard

`PreToolUse(Bash)` reminder hook. Fires when a `git revert <ref>` command targets a commit that's still local-only (not yet on `origin/<current-branch>`).

For unpushed commits, `git reset --soft HEAD~N` or `git rebase -i HEAD~N` cleanly drops the commit. A revert commit just adds a noisy `Revert "..."` entry to local history that gets pushed along with everything else. Revert commits are the right call **only** when the change is already on the remote — you can't rewrite shared history there.

## Behavior

- **Always exits 0.** This is a reminder, not a block.
- Writes a stderr nudge before the tool call so the operator sees it.
- Probes `git merge-base --is-ancestor <ref> @{upstream}` to decide pushed-ness.
  - Pushed → silent. Revert is correct.
  - Unpushed → fire the reminder.
  - No upstream (e.g. new branch) → silent. Avoids false-positives.

## Skipped silently

- `tool_name !== 'Bash'`.
- Command doesn't contain `git revert` outside quoted strings.
- Command has `--no-commit` or `--no-edit` (advanced workflows).
- Target ref can't be resolved (defensive — never false-positive on weird shapes).

## Why a reminder, not a block

There are legitimate reasons to revert an unpushed commit (e.g. emitting a clean "this got rolled back" entry for traceability before a force-push). Blocking would be too aggressive. A stderr nudge gives the operator the information; they decide.

## Source of truth

The rule itself lives in [`CLAUDE.md`](../../../CLAUDE.md) under "Commits & PRs" → "Backing out an unpushed commit". This hook enforces it at edit time.
