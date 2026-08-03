# no-placeholder-commit-subject-guard

PreToolUse hook that blocks a `git commit -m <msg>` /
`--message=<msg>` tool call whose subject line is a content-free
placeholder — `wip`, `init`, `initial`, `test`, `tmp`, `temp`,
`update`, `fix`, `changes`, `commit`, `.`, or an empty subject (see
the full denylist in `.git-hooks/_shared/commit-subject.mts`).

This is the Claude-Bash twin of the placeholder backstop in
`.git-hooks/fleet/commit-msg.mts`. Two surfaces, one denylist:

- This hook catches the junk subject the moment Claude drafts a
  `git commit -m` tool call, before the diff is even staged.
- The `commit-msg` git-stage backstop catches the same subject on a
  subprocess / fresh-worktree / CI / test-harness commit that never
  routes through the Claude tool layer.

## Why blocking

A batch of `initial` / `wip` subjects is the fingerprint of a
replayed or test-harness commit, and the subject is permanent in
`git log` once it lands. A blocking gate forces the operator to
name the change while it is fresh, instead of leaving a wall of
content-free history for the next reader.

## DRY

The placeholder denylist and subject extraction
(`isPlaceholderSubject`, `commitSubject`) live in the canonical
`.git-hooks/_shared/commit-subject.mts` and are imported cross-tree
(the same pattern `commit-author-guard` uses to import
`git-identity.mts`). The `git commit -m` message extraction
(`extractCommitMessage`, `isGitCommit`) is reused from the sibling
`commit-message-format-guard` hook. This hook re-implements neither
the list nor the parser, so the two enforcement surfaces can never
drift.

## Bypass

Type `Allow placeholder-subject bypass` verbatim in a recent user
turn, then retry. The phrase authorises the next blocked
`git commit` invocation within the conversation window.

## Skipped silently

- `tool_name !== 'Bash'`.
- Commands that are not a `git commit` invocation.
- `git commit` with no inline `-m` / `--message` subject (uses
  `-F file`, `-e` editor, or a bare `git commit`) — the editor /
  file / the `commit-msg` git-stage backstop owns those forms.

## Failure mode

Fails open: any internal error logs to stderr and exits 0. The hook
is a quality gate, not a hard dependency — it never wedges the
operator's flow.
