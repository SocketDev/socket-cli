# unbacked-claim-commit-guard

PreToolUse guard (Bash). **Blocks** (exit 2) a `git commit` / `git push` when
the last assistant turn made a success claim no command this session backs.

## What it does

When the turn's prose claims "tests pass" / "the build succeeds" /
"typechecks" / "lint passes" / "render verified" but no Bash command this
session ran the matching check, this guard blocks the commit/push. It stops an
unverified claim from landing.

## Relationship to stop-claim-verify-nudge

Two surfaces, one matcher:

- `stop-claim-verify-nudge` (Stop) nudges at turn-end — catches the claim
  even on a turn that doesn't commit.
- `unbacked-claim-commit-guard` (this, PreToolUse) hard-blocks the commit/push —
  the unverified claim can't land.

Both consume `_shared/unbacked-claims.mts` (`CLAIM_RULES` / `findUnbackedClaims`
/ `sessionBashCommands`), so the detection never drifts between them.

## Trigger

Fires on `Bash` when the command invokes `git commit` or `git push` (parsed
with the shared shell parser — sees through chains and `git -C`). Pull / fetch /
status don't land work, so they don't fire.

## Bypass

Type `Allow unbacked-claim bypass` in a recent user turn — when the claim is
true but verified outside this session, or is acceptable to land.
