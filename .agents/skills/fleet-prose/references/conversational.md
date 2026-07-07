# Conversational mode

Extra rules for **conversational** surfaces (PR descriptions + comments, issue bodies + replies, review comments, Linear, status summaries, commit bodies). Apply these ON TOP of the Core Rules. They do not apply to documentation (`docs/`, README, CHANGELOG, release notes, API reference).

The goal shifts from "complete, precise, durable" (documentation) to "land the point now, to a specific person, in the moment." Shorter is better. Personality is fine. The model voice is a maintainer talking to a peer on a PR, not a report.

## Contents

- Lead with the point
- Be brief
- Show the receipt
- Code beats prose
- Plain, direct register
- Ask when collaborating
- No structure for its own sake
- Drop the AI scaffolding

## Lead with the point

The first sentence is the decision, the finding, or the answer. No preamble, no restating the task, no "Great question" / "Sure thing" / "Thanks for the report."

- Bad: "Thanks for flagging this! I took a look and it seems like there might be an issue with how the cache is invalidated."
- Good: "This is a cache-invalidation bug: the key is computed from mtime, which FAT32 rounds to 2s."

## Be brief

Default to 1-3 sentences. A comment that could be one line should be one line. Cut anything the reader already knows.

- Good (a whole comment): "It's a bigger typo than that, it's supposed to be `clearTimeout` :P"
- Good (a whole comment): "Related: #62893."

## Show the receipt

Back a claim with evidence, not adjectives. Link the issue / PR / commit SHA, paste the repro, drop the real numbers. Never "this is faster" without the measurement.

- Bad: "This should be significantly more performant."
- Good: "`acorn` ~700ms vs `swc` ~2s on babylon.max.js (10.6MB)." or a pasted `hyperfine` / `vitest bench` line.

## Code beats prose

When code is the answer, paste it. A two-line function or a runnable command is clearer than a paragraph describing it.

```js
function isPrimitive(value) {
  return Object(value) !== value
}
```

## Plain, direct register

Contractions are fine. Casual is fine. A `:)` or `~~strikethrough~~` is fine when it fits. This is a person talking to a person. Real openers ("Ya", "Hmm", "Ah", "Boo!") beat service-desk ones. Still no secrets and no private names (public-surface-hygiene is unchanged on every surface).

## Ask when collaborating

A question pulls people in. "What do you think?" or "@person — thoughts?" beats a wall of unilateral justification. Credit good work plainly: "good catch", "nice, the perf is rad".

## No structure for its own sake

Do not impose Summary / Changes / Testing headers on a PR a sentence describes. Use a list only when there genuinely are N parallel items. A small PR body is one sentence on what + why, then (if needed) a short list of the non-obvious changes, then the test note. Big PRs earn structure; small ones do not.

## Drop the AI scaffolding

The biggest tell. Cut all of it:

- Opening throat-clearers: "I've gone ahead and...", "Let me...", "In this PR, I..."
- Closing filler: "Let me know if you have any questions!", "Hope this helps!", a trailing summary that repeats the opening.
- Restating what the diff already shows ("This changes the function to...").
- Hedge-stacking: "essentially", "fundamentally", "simply", "just", "basically".
- Em-dash chains and "not X, it's Y" contrast pairs (the Core Rules catch these; they are especially glaring in a short comment).
