# perfectionist-reminder

Stop hook that scans the assistant's most recent turn for speed-vs-depth choice menus where the perfectionist path is the obvious right answer.

## Why

CLAUDE.md "Judgment & self-evaluation" says:

> Default to perfectionist when you have latitude. "Works now" ≠ "right." Before calling done: perfectionist vs. pragmatist views. Default perfectionist absent a signal.

Sister rule from "Fix > defer" already catches "implement vs accept-as-gap" via `excuse-detector`. The speed-vs-depth menu is a different but related failure pattern: offering "Option A (do it right) / Option B (ship fast)" as a binary choice when the user already signaled they want correctness (asked the right question, requested a thorough audit, said "do it properly", etc.).

The assistant's job is to internalize the perfectionist default and execute, not re-litigate the velocity tradeoff every time the work is non-trivial.

## What it catches

| Phrase pattern | Why it's flagged |
|---|---|
| `Option A (depth)… Option B (speed)` | Binary choice menu offloading judgment. Pick depth. |
| `maximally useful vs maximally shipped` | Same framing — execute the perfectionist path. |
| `ship-it precision`, `ship-it-now` | Velocity euphemism. Use only when user time-boxed. |
| `depth over breadth?` / `breadth over depth?` | The default IS depth (perfectionist). |
| `speed vs depth`, `fast vs right`, `now vs correct` | Speed-vs-quality framing. Perfectionist is default. |
| `if you say A … if you say B` | Binary choice architecture pretending to be helpful. |
| `plow through vs do it right` | Same pattern — velocity vs care. |

## Legitimate exceptions

The hook can't tell from text alone whether the trade-off is real:

- **User explicitly asked** "is this worth doing fully?" — they introduced the dichotomy.
- **Time-boxed engagement** — the user said "we have 1 hour" and the work needs more.
- **Off-machine action required** — the perfectionist path needs gh dispatch / npm publish / infra access.

In all three cases, the menu is genuinely useful framing. The hook still flags it; the user reads the warning and decides.

## Why it doesn't block

Stop hooks fire after the assistant has produced its response. Blocking would truncate. The warning surfaces alongside the response so the user reads both and can push back next turn.

## Configuration

`SOCKET_PERFECTIONIST_REMINDER_DISABLED=1` — turn off entirely.

## Relationship to excuse-detector

`excuse-detector` catches **fix vs defer** ("should I implement X or accept as gap?"). This hook catches **depth vs speed** ("should I do it properly or ship a quick version?"). Different failure modes, same underlying anti-pattern: a choice menu where the user already picked.

## Test

```sh
pnpm test
```
