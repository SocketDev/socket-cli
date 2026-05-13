# identifying-users-reminder

Stop hook that flags generic "the user" / "this user" / "the developer" references in the assistant's most-recent turn where naming or "you" would be more appropriate.

## Why

CLAUDE.md "Identifying users":

> Identify users by git credentials and use their actual name. Use "you/your" when speaking directly; use names when referencing contributions.

The failure mode this catches: the assistant says "the user wants X" instead of either:
- "you want X" (if speaking directly), or
- "jdalton wants X" (if referencing what someone did)

"The user" reads as bureaucratic distance — like the assistant is filing a ticket about the person rather than working with them.

## What it catches

| Pattern | Example |
|---|---|
| `the user wants/needs/asked/said` | "the user wants this fixed" |
| `this user` (singular reference) | "this user prefers concise output" |
| `someone wants/needs/asked` (sentence-initial) | "Someone asked about X earlier" |
| `the developer/engineer wants/needs` | "the developer prefers tabs" |

## What it does NOT catch

- `you` / `your` — direct address, the right shape
- `users` (plural) — talking about user populations
- `the user can` / `if a user types` — generic API/UX description (the verb list is intentionally narrow to exclude these)

## Why it doesn't block

Stop hooks fire after the turn. Blocking would just truncate. The warning prompts the next turn to revise the framing.

## Configuration

`SOCKET_IDENTIFYING_USERS_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
