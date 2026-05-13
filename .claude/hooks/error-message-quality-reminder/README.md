# error-message-quality-reminder

Stop hook that inspects code blocks the assistant wrote for low-quality error message strings — `throw new Error("invalid")`, `throw new RangeError("failed")`, etc.

## Why

CLAUDE.md "Error messages":

> An error message is UI. The reader should fix the problem from the message alone. Four ingredients in order:
> 1. **What** — the rule, not the fallout (`must be lowercase`, not `invalid`)
> 2. **Where** — exact file/line/key/field/flag
> 3. **Saw vs. wanted** — bad value and the allowed shape/set
> 4. **Fix** — one imperative action (`rename the key to …`)

This hook catches the trivial-vague case: a `throw new <X>Error(...)` whose entire message is a single vague word or short phrase with no field, no value, no rule.

## What it catches

| Pattern | Example | Hint |
|---|---|---|
| Bare `invalid` | `throw new Error("invalid")` | "Invalid" is the fallout. State the rule: "must be lowercase", "must match /^[a-z]+$/". |
| Bare `failed` | `throw new Error("failed")` | Name what was attempted: "could not write \<path\>: ENOENT". |
| Bare `error occurred` | `throw new Error("an error occurred")` | Says nothing actionable. State rule, location, bad value. |
| `something went wrong` | `throw new Error("something went wrong")` | Pure filler. |
| `unable to X` / `could not X` | `throw new Error("unable to read")` | Add object + reason: "could not read \<path\>: \<errno\>". |
| `not found` | `throw new Error("not found")` | Missing what? Where? "config file not found: \<path\>". |
| `bad` / `wrong` / `incorrect` | `throw new Error("bad value")` | Describe the rule the value violated, not how you feel about it. |

## What it does NOT catch

The check is intentionally conservative — only the trivially-vague cases. Skipped:

- Messages containing `:` (signals a field-path prefix like `"user.email: must be lowercase"`)
- Messages containing quoted values (`"`, `` ` ``) — suggests "saw vs. wanted" content
- Messages longer than 40 chars (likely have the four ingredients spread across the sentence)
- Dynamic templates with `${...}` (the static check can't know the interpolated content)

Conservative by design: the goal is to flag the cases that are 100% definitely wrong, not to grade every message. The user reads the warning and decides if there are deeper quality issues to address.

## Why it doesn't block

Stop hooks fire after the assistant produced the code. The vague-error is already in the diff. The warning prompts the next turn to revise.

## Configuration

`SOCKET_ERROR_MESSAGE_QUALITY_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
