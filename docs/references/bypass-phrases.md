# Hook bypass phrases

Reverting tracked changes or bypassing the fleet's hook chain requires the user to type the canonical phrase verbatim in a recent user turn. Inferring intent from "go ahead", "skip the hook", "fix it", etc. does NOT count.

The phrase format is `Allow <X> bypass` — case-sensitive, exact match.

| Operation                                                                                                                                                                                                   | Phrase                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Revert (any of: `git checkout -- <files>`, `git checkout <ref> -- <files>`, `git restore <files>` without `--staged`, `git reset --hard`, `git stash drop` / `pop` / `clear`, `git clean -f`, `git rm -rf`) | `Allow revert bypass`     |
| `git --no-verify` (skips husky hooks)                                                                                                                                                                       | `Allow no-verify bypass`  |
| `git --no-gpg-sign` / `-c commit.gpgsign=false`                                                                                                                                                             | `Allow gpg bypass`        |
| `DISABLE_PRECOMMIT_LINT=1` (skips lint step)                                                                                                                                                                | `Allow lint bypass`       |
| `DISABLE_PRECOMMIT_TEST=1` (skips test step)                                                                                                                                                                | `Allow test bypass`       |
| `git push --force` / `-f`                                                                                                                                                                                   | `Allow force-push bypass` |

## Scope

A phrase from a previous session does not carry over — only the current conversation's user turns count. The hook reads the active session's transcript (passed by Claude Code as `transcript_path` in the PreToolUse payload) and searches the concatenated user-turn text for the exact phrase.

The match is **case-sensitive** and **substring-based**:

- ✓ `Allow revert bypass — please drop my last edit`
- ✓ a multi-line user message with `Allow revert bypass` on its own line
- ✗ `allow revert bypass` (lowercase)
- ✗ `please revert that file` (paraphrase)
- ✗ `--no-verify is fine` (no `Allow ... bypass` shape)

## Why a phrase

Without the gate, the assistant has historically reverted whole batches of autofix changes mid-cleanup or used `--no-verify` to push past a failing hook, both of which destroy work and erode trust. The phrase is short enough to type when truly intended and specific enough that no other utterance accidentally triggers it.

## Defense in depth

The bypass policy is enforced at three layers:

- **CLAUDE.md** documents the rule (`### Hook bypasses require the canonical phrase`).
- **Memory** keeps the assistant honest across sessions even before the hook fires.
- **`.claude/hooks/no-revert-guard/`** is the actual enforcement: a `PreToolUse(Bash)` hook that scans the proposed command, parses the transcript, and exits 2 with a clear stderr message naming the phrase the user must type.

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy can't brick the session. Trade-off: a buggy hook silently allows the destructive command. Acceptable because the alternative (hook crash wedges the session) is worse for development velocity.

## How to add a new bypass

When introducing a new destructive flag or hook bypass:

1. Add a new entry to the `CHECKS` array in `.claude/hooks/no-revert-guard/index.mts`. Each check is `{ pattern: RegExp, bypassPhrase: string, label: string }`.
2. Add a row to this reference's table.
3. Add a test case to `.claude/hooks/no-revert-guard/test/index.test.mts` covering both the blocked-without-phrase and allowed-with-phrase paths.
4. Cascade via `node socket-wheelhouse/scripts/sync-scaffolding.mts --all --fix` so every fleet repo picks up the change.
