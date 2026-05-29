# dont-blame-user-reminder

Claude Code `Stop` hook that scans the assistant's most recent turn for phrases that blame the user (or "the linter") for state the assistant's own scripts most likely produced.

## Why

CLAUDE.md's _"Fix it, don't defer"_ block has a rule: don't blame the user (or "the linter") when your own edits get reverted between turns. The cause is almost always the assistant's own machinery — pre-commit autofix, sync-cascade from `template/`, `oxlint --fix`, `oxfmt`. Attributing the change to the user instead of investigating those scripts is a deferral: it lets the assistant stop debugging without finding the actual cause.

Past incident: the assistant repeatedly claimed "the user reverted my edits" / "the linter stripped my assertions" / "the user prefers state with no assertions" when the strips were actually produced by template-canonical sources + the sync-cascade.

## What it catches

| Phrase shape                                                    | Why it's flagged                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `the user/linter/formatter reverted/stripped/removed/rewrote …` | Attributes state to the user/tool as the cause, with no investigation. |
| `user's intentional/preferred/preserved state`                  | Same — assumes intent the assistant hasn't evidenced.                  |
| `removed/reverted/stripped by the user/linter/formatter`        | Same.                                                                  |
| `the user/linter wants/chose to keep/strip/remove …`            | Same.                                                                  |

Quoted spans are stripped before matching, so the hook doesn't self-fire when the assistant _describes_ these phrases (e.g. paraphrasing this doc in a turn summary).

## Why it blocks

Unlike most `Stop` reminders, this one runs in **blocking** mode: the assistant must continue the turn and either (a) prove the blame with hard evidence — a quoted user message, a `git reflog` entry, a commit hash — or (b) keep investigating which script produced the reverted state (`git log -S`, run pre-commit phases in isolation, diff `template/` canonical sources). `stop_hook_active` suppresses it after the first fire, so it triggers at most once per stop chain.

## Configuration

`SOCKET_DONT_BLAME_USER_DISABLED=1` — turn the hook off entirely.

## Test

```sh
pnpm test
```
