# ask-suppression-reminder

PreToolUse hook (reminder, NOT a block) that fires on AskUserQuestion when
the recent transcript carries explicit go-ahead directives.

## Why

The user has flagged repeated AskUserQuestion as friction-generating
behavior. Memory captures the rule in `feedback_dont_ask_proceed`: when the
user has said "do it" / "yes" / "proceed" / "1", the assistant should pick
the obvious default and execute, not pose a clarifying question.

A blocker would be too aggressive — sometimes a binary question after "yes"
is genuinely scoping (e.g. "yes proceed — but which of these N approaches?").
A reminder gives the assistant the signal to reconsider without preventing
legitimate scoping.

## What it surfaces

| User turn pattern                             | Reminder? |
| --------------------------------------------- | --------- |
| `yes` / `y` / `do it` / `proceed` / `go`      | yes       |
| `continue` / `1` / `all of them` / `ship it`  | yes       |
| `ok` / `sure` / `k`                           | yes       |
| Long paragraph that happens to contain "yes"  | no        |
| (must be the full trimmed message body)       |           |
| Question or scoping requests in the user turn | no        |

Scans the last 3 user turns. The matched turn must be the ENTIRE trimmed
message body, not a substring — this avoids firing on "yes" buried in
sentence prose.

## Bypass

No bypass — the reminder never blocks.
