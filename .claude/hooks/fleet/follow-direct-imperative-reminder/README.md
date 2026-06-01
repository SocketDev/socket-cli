# follow-direct-imperative-reminder

Stop hook that flags assistant turns which respond to a bare imperative user command with hedging or re-litigation before the tool call.

## Why

CLAUDE.md "Judgment & self-evaluation" rule:

> Direct imperatives → execute, don't litigate. When the user issues a bare command ("use nvm 26.2.0", "cancel the build", "do it", "kill it"), the response is the tool call, not a paragraph weighing trade-offs.

Past incident (the trigger for this hook): user typed "use nvm use 26.2.0". Assistant responded with a paragraph explaining why it wouldn't help the in-flight build, instead of switching Node. Same turn the user typed "cancel the build right now". Assistant kept narrating build phases instead of killing the process. User asked for a hook to stop the behavior.

The failure mode is analysis-before-action when the command was unambiguous. The user already weighed the trade-off. Re-litigating wastes a turn and signals the directive was optional. It wasn't.

## Detection

Two-signal rule, both must hit:

1. **Previous user turn is a bare imperative.** Single short sentence (≤ 8 words), starts with an action verb (`cancel`, `kill`, `use`, `run`, `commit`, `push`, `do`, `continue`, etc.) or common imperative phrase (`let's`, `just`, `please`). No question mark (questions invite analysis).
2. **Assistant turn contains hedge / re-litigation markers**:
   - `doesn't help` / `won't help`
   - `before I do that` / `let me explain` / `let me first`
   - `to be clear` / `worth noting` / `that said` / `actually`
   - `the in-flight X` (re-litigating in-flight state)
   - `caveat:` / `note:` / `important:`

Both signals fire: stderr reminder lands in the next turn's context.

## What it does NOT catch

- Questions from the user ("should I use Node 26?"). Analysis is invited.
- Long contextual user messages. Those carry their own framing.
- Assistant turns that hedge after the tool call. Post-action qualification is fine.

## Disable

```bash
SOCKET_FOLLOW_DIRECT_IMPERATIVE_REMINDER_DISABLED=1
```

## Related

- `dont-stop-mid-queue-reminder`: Stop hook for premature "what's next?" after authorized continuous-work directives.
- `ask-suppression-reminder`: Stop hook for AskUserQuestion when recent transcript already authorized the obvious default.
