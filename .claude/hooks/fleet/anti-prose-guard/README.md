# anti-prose-guard

The fleet's one blocking prose guard, on both surfaces prose lands on.

- **PreToolUse** — BLOCKS Write/Edit to human-facing prose surfaces
  (`CHANGELOG.md`, `docs/**/*.md`, `README.md`) when the new content carries an
  AI-writing antipattern.
- **Stop** — BLOCKS turn-end when the chat reply carries a CATEGORICAL ban.

## Why

CLAUDE.md's "Prose authoring" rule: human-facing prose runs through the `prose`
skill before it lands. The skill strips throat-clearing openers, "not X, it's Y"
contrasts, every em-dash, and vague hedging adverbs. This guard enforces it as a
hard block at write time — it supersedes the old `prose-antipattern-nudge`
Stop hook (a reminder fires after the write and is ignorable; a PreToolUse block
stops the bad prose from landing). Fleet convention: `-guard` blocks, `-nudge`
nudges — one surface per concern, never both.

## What it catches

| Pattern                  | Why it's flagged                                                        |
| ------------------------ | ----------------------------------------------------------------------- |
| em-dash (any, not a chain) | Reads AI-generated, even one. Replace it with a plain hyphen, same spacing. Code spans and fenced blocks are exempt. |
| throat-clearing opener   | "Here's the thing" / "Let me" / "It's worth noting" preamble.           |
| "not X, it's Y" contrast | An AI-prose reversal tic. State the point directly.                     |
| hedging adverb           | basically / essentially / fundamentally / simply / just.                |

## The two tiers

`patterns.mts` splits the table in two, and the split is what lets one guard
cover both surfaces.

`CATEGORICAL_PROSE_BANS` are verdicts: the word itself is the defect, so there
is no sentence where the match is wrong. Today that is the honesty family
(`honest` / `honestly` / `honesty`, `frankly`, `papered over`), read from the
shared `_shared/honesty-framing.mts` matcher that `convo-prose-nudge` also
consumes. Everything else is a heuristic that can over-fire on a legitimate
sentence.

The doc-write path scans the whole table, because the author can reword and
retry. The Stop path scans the categorical tier ALONE — the heuristics would
over-fire on a reply, and `reply-prose-nudge` already whispers about them.

Two behaviors on the Stop path are load-bearing:

- It blocks even while another Stop guard is being retried
  (`stop_hook_active`). Degrading to a notice there let a reply rewritten for a
  different guard smuggle the framing through. There is no deadlock risk —
  deleting a word always satisfies this guard.
- Code fences are stripped before scanning, so a banned token quoted in a
  fence never fires. This README, a matcher source, and a post-mortem all
  quote them freely.

## Scope

Only the prose surfaces above are guarded — `src/` and other code files are not
scanned for prose patterns. The match runs against the normalized (forward-slash)
path, so it holds on every platform. The doc-write path is fleet-scoped
(`fleetOnly`); the Stop path is not, because a chat reply has no file to judge
and the banned framing is just as wrong in a foreign checkout.

## Bypass

Doc writes: the user types `Allow prose-antipattern bypass` verbatim in a recent
turn. The reply has none — rewrite the sentence.

## Test

```sh
pnpm test
```
