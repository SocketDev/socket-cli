# dont-blame-reminder

Claude Code `Stop` hook that scans the assistant's most recent turn for phrases that blame the user (or "the linter") for state the assistant's own scripts, or a parallel Claude session, most likely produced.

## Why

CLAUDE.md's _"Fix it, don't defer"_ block has a rule: don't blame the user (or "the linter") when edits get reverted or rewritten between turns. The cause is either the assistant's own machinery (pre-commit autofix, sync-cascade from `template/`, `oxlint --fix`, `oxfmt`) or a parallel Claude session editing the same checkout. Files changing between Read and Edit ("modified since read") are a concurrent session's fingerprint, not a linter. Attributing the change to the user or "the linter" instead of investigating is a deferral: it lets the assistant stop debugging without finding the actual cause.

Example phrases that flag: "the user reverted my edits", "the linter stripped my assertions", "the linter rewrote it". The real cause is usually a template-canonical source plus the sync-cascade, or a concurrent session's commit (found with `git log --oneline -8`).

## What it catches

| Phrase shape                                                    | Why it's flagged                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `the user/linter/formatter reverted/stripped/removed/rewrote …` | Attributes state to the user/tool as the cause, with no investigation. |
| `user's intentional/preferred/preserved state`                  | Assumes intent the assistant hasn't evidenced.                         |
| `removed/reverted/stripped by the user/linter/formatter`        | Same.                                                                  |
| `the user/linter wants/chose to keep/strip/remove …`            | Same.                                                                  |

Quoted spans are stripped before matching, so the hook doesn't self-fire when the assistant _describes_ these phrases (e.g. paraphrasing this doc in a turn summary).

## Why it blocks

Unlike most `Stop` reminders, this one runs in **blocking** mode. The assistant must continue the turn and either (a) prove the blame with hard evidence (a quoted user message, a `git reflog` entry, a commit hash) or (b) keep investigating the real cause (its own script, or a parallel session) via `git log --oneline -8`, `git log -S`, pre-commit phases in isolation, and a `template/` diff. `stop_hook_active` suppresses it after the first fire, so it triggers at most once per stop chain.

## Test

```sh
pnpm test
```
