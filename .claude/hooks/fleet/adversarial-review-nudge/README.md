# adversarial-review-nudge

Stop hook that fires when the assistant's most-recent turn treats a clean
automated review — a review bot reporting no findings — as a review verdict,
without evidence that an adversarial self-review ran.

## Why

A clean bot pass is one reviewer shape finding nothing: absence of findings,
not evidence of absence. The failure mode this hook catches is the assistant
reporting "bugbot came back clean, nothing to respond to" and ending the turn
as if the change were reviewed. On substantive diffs, the adversarial
self-review loop routinely finds load-bearing defects that a single automated
pass misses — including defects introduced by the previous round's own fixes.

Doctrine: `docs/agents.md/fleet/adversarial-self-review.md`.

## What it catches

A review-bot token and a clean-verdict token in the same sentence-ish window
(either order), in the last assistant turn's prose (code fences stripped):

| Bot token                                 | Clean-verdict token                          |
| ----------------------------------------- | -------------------------------------------- |
| `bugbot`, `copilot`, `auto-review`        | `no issues/findings/comments found`          |
| `automated review`, `review bot(s)`       | `came back clean`, `found nothing`           |
| `bot review(er)`, `ai review`             | `nothing to address/fix/flag/respond to`     |
|                                            | `clean pass`, `all green`, `all clear`       |

## Suppression

Any one of these in the same turn suppresses the nudge:

- Adversarial language in the prose: `adversarial`, `refute(d)`, `red-team`,
  `devil's advocate`, `skeptic`.
- A spawned reviewer agent: a `Task`/`Agent` tool call whose prompt,
  description, or subagent type reads as a review (`review`, `adversar*`,
  `refut*`, `skeptic`, `red-team`).

Skipping the adversarial loop is legitimate for trivial diffs — the nudge
asks for that to be said explicitly rather than letting bot silence stand in
for review.

## Why it doesn't block

Stop hooks fire after the turn; blocking would truncate the response, and a
clean bot pass genuinely ends the work often enough (docs-only diffs,
mechanical renames) that a hard gate would punish the legitimate cases. The
nudge makes skipping a decision instead of a default.

## Bypass

No bypass — the reminder never blocks.

## Test

```sh
pnpm test
```
