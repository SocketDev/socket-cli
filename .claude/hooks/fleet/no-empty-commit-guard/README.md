# no-empty-commit-guard

PreToolUse hook that blocks two empty-commit shapes the fleet bans
(see CLAUDE.md "Commits & PRs → No empty commits"):

1. `git commit --allow-empty` (with or without `-m`, also covers
   `--allow-empty-message`).
2. `git cherry-pick --allow-empty` / `--keep-redundant-commits` —
   replaying a no-content commit forward.

## Why blocking

Empty commits pollute `git log`, break CHANGELOG generators (which
expect each commit to carry a diff), and hide intent: a future
reader can't tell whether the author meant to amend the previous
commit, anchor a tag, or something else.

The canonical way to anchor a release tag forward is
`git tag -f vX.Y.Z <real-content-commit>` against an actual content
commit, not a fake "anchor" commit with no diff. Force-moving the
tag is a cleaner mechanism than synthesising history.

## Bypass

Type `Allow empty-commit bypass` verbatim in a recent user turn,
then retry. The phrase authorises the next blocked `git commit`
or `git cherry-pick` invocation within the conversation window.

## Skipped silently

- `tool_name !== 'Bash'`.
- Commands that don't contain `git commit` or `git cherry-pick`.
- `--allow-empty` appearing inside a quoted string (e.g. inside a
  `-m` commit-message body that mentions the flag).

## Failure mode

Fails open: any internal error logs to stderr and exits 0. The hook
is a quality gate, not a hard dependency — it never wedges the
operator's flow.
