# judgment-reminder

Stop hook that flags hedging language in the assistant's most-recent turn. Two-layer detection: regex for fixed phrases, compromise.js for modal-verb judgment hedges.

## Why

CLAUDE.md "Judgment & self-evaluation":

- "Default to perfectionist when you have latitude."
- "If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, try something fundamentally different."

Hedging undermines those rules — it offloads judgment back to the user instead of executing the perfectionist default.

## What it catches

### Fixed-phrase regex layer

| Phrase | Why it's flagged |
|---|---|
| `I'm not sure` / `I am not sure` | Hedge; state a recommendation with rationale instead. |
| `you decide` / `your call` / `up to you` | Offloads judgment. Pick the recommended path. |
| `either approach works` / `either way works` | False-equivalence hedging. Pick one. |
| `let me know` / `your preference` | Hand-off phrasing. Ask one specific question or execute. |
| `maybe X` / `perhaps X` (sentence-initial) | Front-loaded uncertainty user didn't ask for. |

### Modal-verb NLP layer (compromise.js)

Flags first-person modals in judgment contexts:

- `I could go either way`
- `we might want to consider`
- `I may pick the simpler approach`

The compromise.js library tags verbs with POS so we can distinguish judgment hedges ("I could go") from technical conditionals ("the parser could throw") — regex alone would false-positive on the latter.

**Fail-open**: if compromise.js fails to load, the hook degrades to a regex-only fallback that catches the most common shape but misses some context.

## Why it doesn't block

Stop hooks fire after the assistant has produced its response. Blocking would truncate. The warning surfaces alongside the response so the user reads both and can push back next turn.

## Configuration

`SOCKET_JUDGMENT_REMINDER_DISABLED=1` — turn off entirely.

## Relationship to other reminders

- `excuse-detector` — catches fix-vs-defer choice menus
- `perfectionist-reminder` — catches speed-vs-depth choice menus
- `judgment-reminder` (this) — catches hedging within a single position

All three address the same underlying anti-pattern: offloading judgment the assistant should have made.

## Dependencies

- `compromise@14.15.0` — NLP library for POS-tagged modal-verb detection. Lazy-loaded; optional.

## Test

```sh
pnpm test
```
