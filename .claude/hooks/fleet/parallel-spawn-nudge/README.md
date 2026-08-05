# parallel-spawn-nudge

PreToolUse hook on `Agent` / `Task`, non-blocking. Points out that the previous turn spawned a single agent and this turn is spawning another, so the two are running one after the other instead of side by side.

## Why

`agent-prompt-budget-guard` refuses an open-ended brief and caps a scoped one at five minutes. Work that used to be a single long spawn now has to be split into several scoped ones — and that split only pays off if the pieces run at the same time. Fired one per turn, the pieces cost the same wall-clock as the one long spawn they replaced.

The numbers behind the message are measured: a tight brief runs 6.4-7.4 seconds per tool call, an open-ended one 13.6-43.8, and every spawn pays roughly 15 seconds of fixed startup. Batching the spawns pays that startup once in parallel rather than serially, and it stops each agent from waiting out the other's full run.

## What it catches

The nudge fires when both hold:

| Condition       | Detail                                                            |
| --------------- | ----------------------------------------------------------------- |
| Previous turn   | The immediately preceding assistant turn has exactly ONE `Agent`/`Task` tool use. |
| Current call    | This call is an `Agent` or `Task` spawn.                          |

"Exactly one" is deliberate. A previous turn carrying two or more spawns is already the batched shape the nudge asks for, so the hook stays silent on it.

## What it does not catch

- A pipeline, where this spawn consumes the previous agent's result. The tool payload cannot show that dependency, so the message names the exception outright instead of guessing.
- `SendMessage`, which resumes an agent that already exists rather than starting a new one.
- A previous turn with no spawn at all.

## Verdict

Always a notice, never a block. Exit code 0. No bypass phrase: a nudge you can ignore does not need one.
