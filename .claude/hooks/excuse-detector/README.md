# excuse-detector

Claude Code `Stop` hook that scans the assistant's most recent turn for excuse-shaped phrases and warns to stderr at end-of-turn.

## Why

CLAUDE.md has two rules the assistant routinely tries to wriggle out of:

- **No "pre-existing" excuse** — fix lint/type/test errors you see in your reading window. Don't label them "pre-existing" and walk past.
- **Unrelated issues are critical** — an adjacent bug is exactly the bug nobody is currently looking for. Don't defer.

The phrases that precede those deferrals are predictable: "pre-existing", "not related to my X", "unrelated to the task", "out of scope", "separate concern", "leave it for later", "not my issue". This hook scans the transcript for them.

## What it catches

| Phrase | Why it's flagged |
|---|---|
| `pre-existing` / `preexisting` | Bare rationalization; CLAUDE.md bans the label. |
| `not related to my <X>` | Scoping out a fix. CLAUDE.md says fix it. |
| `unrelated to the task` | Same. |
| `out of scope` | Same. The genuine exception (large refactor) requires asking, not silent deferral. |
| `separate concern` | Same. |
| `leave it for later` | Deferral marker. CLAUDE.md "Completion" bans deferrals. |
| `not my issue` / `not my problem` | Scoping out. |

## Why it doesn't block

Stop hooks fire *after* the assistant has produced its response. Blocking at that point would just truncate the message — the rationalization is already out. The warning surfaces alongside the response so the user reads both, and can push back in the next turn.

The right enforcement is layered:

- **CLAUDE.md rule** documents the policy.
- **This hook** surfaces violations at end-of-turn.
- **The user** demands the fix in the next turn.

## Configuration

`SOCKET_EXCUSE_DETECTOR_DISABLED=1` — turn the hook off entirely. Useful for sessions where the policy genuinely doesn't apply (e.g. running a long-form review that intentionally calls out scope boundaries).

## Test

```sh
pnpm test
```
