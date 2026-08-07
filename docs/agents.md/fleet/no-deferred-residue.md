# Name it, then fix it or record it

Naming leftover work means you already did the expensive part: finding it. Do it, or leave an explicit handle. Never both name it and drop it.

## The economics

Finding a stale header, a dangling reference, a half-applied rename is the work. Writing "there is a stale header here" and stopping throws that away - the next session re-derives the same finding cold, without the context that made it cheap.

And the next session is almost always the same one. The work gets done regardless; the only question is whether it happens now, with the file open, or later at full price. A deferral does not save the work. It raises the price.

## What counts as a handle

| Shape | Handle? |
| --- | --- |
| `Follow-up: rewrite preflight.mts's @file header for --tests` | yes |
| `- [ ] drop the dead SCANNER_BYPASS_RE` | yes |
| `Next: cascade, then re-run the suite` | yes |
| "worth looking at sometime" | no |
| a sentence buried mid-paragraph | no |

A handle names the file and the change, and survives a skim.

## A blocker is not a deferral

"I cannot land this because the cascade refuses while `template/` is dirty" states a concrete obstacle and names what clears it. That is a status report, and it needs no handle.

"I am not starting another cycle for this" is a choice. That needs one.

## Enforcement

`deferred-residue-guard` (Stop hook) blocks a turn-end reply that names leftover work and carries neither a fix nor a follow-up marker. It reads the reply text only, so adding the line satisfies it in-turn; it cannot deadlock against a guard waiting on the tree. See [`hook-registry`](hook-registry.md).

## Why

A turn ended with "one known residue I'm not starting another cycle for: the `@file` header is stale". Accurate, specific, and immediately lost. It cost an extra round trip to spend thirty seconds on a comment - the sentence announcing the deferral was longer than the fix.

See also: [`preflight-before-the-gate`](preflight-before-the-gate.md) - the same economics one step earlier.
