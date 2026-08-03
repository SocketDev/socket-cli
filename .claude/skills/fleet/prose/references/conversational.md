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
- Write like a decisive, generous maintainer
- No structure for its own sake
- Use GitHub's formatting when structure is earned
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

## Write like a decisive, generous maintainer

State the proposal or answer, name the concrete reason, and give the next action. For a
breaking or architectural change, name the migration path and what would reverse the
decision. Ask focused stakeholders for input when their code or users are affected.

Use examples, links, and small code snippets instead of abstract explanation. A reviewer may
write a short direct request, but write a complete sentence and explain any non-obvious
mechanism at a junior-developer level. "Use `get(object, key)` here because it already handles
the inherited-key case" is clearer than "Same here." A terse comment is fine only when the
surrounding diff makes its meaning unambiguous.

Be warm without service-desk padding: thank a contributor, say "no worries" when it fits, and
credit useful work. Do not manufacture cheerfulness, vague praise, or a conclusion that the
evidence does not support.

## No structure for its own sake

Do not impose Summary / Changes / Testing headers on a PR a sentence describes. Use a list only when there genuinely are N parallel items. A small PR body is one sentence on what + why, then (if needed) a short list of the non-obvious changes, then the test note. Big PRs earn structure; small ones do not.

## Use GitHub's formatting when structure is earned

These render on every GitHub prose surface (PR/issue bodies, comments, reviews, discussions, release notes). Reach for them when a body has a decision plus supporting evidence, alternatives, migration notes, or a multi-item plan. Keep a one-line or 1-3 sentence reply flat; do not hide a simple answer in a fold.

### Collapsed sections

Long supporting material folds under `<details>`; the verdict stays outside the fold. A reader sees the point first and opens the evidence only when they want it. The blank line after `</summary>` is required or the markdown inside will not render.

```markdown
The fix is a one-line cache-key change; full benchmark matrix below.

<details>
<summary>Benchmarks (12 runs, M3 Max)</summary>

| parser | p50   | p95   |
| ------ | ----- | ----- |
| acorn  | 700ms | 810ms |

</details>
```

Write the `<summary>` as a specific label ("Benchmarks (12 runs, M3 Max)"). "Details" / "More info" / "Click to expand" tell the reader nothing about whether to open it.

### Alerts

GitHub renders five blockquote alerts: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`. Use at most one per body, for the single thing a skimming reader must act on: a breaking change or a required migration step. Stacked alerts cancel each other out.

```markdown
> [!WARNING]
> Rolling back past v3.2 loses the migrated soak annotations.
```

### Task lists

`- [ ]` items in a PR/issue body are live checkboxes, and GitHub shows N-of-M progress wherever the issue is referenced. Use them for genuinely actionable follow-ups and check them off as they land. A task list nobody updates is worse than a sentence.

### Autolinks and permalinks

Bare references autolink: `#123`, `owner/repo#123` for cross-repo, full commit SHAs, and `@user`. Paste a file permalink with a line range (press `y` in the file view for the canonical URL, then select the lines) and GitHub embeds the code snippet inline in the body — better than a re-typed excerpt because it cannot drift.

### Footnotes

`[^1]` footnotes park an aside without derailing the paragraph. One or two per body at most; more than that means the body wants a `<details>` section instead.

## Drop the AI scaffolding

The biggest tell. Cut all of it:

- Opening throat-clearers: "I've gone ahead and...", "Let me...", "In this PR, I..."
- Closing filler: "Let me know if you have any questions!", "Hope this helps!", a trailing summary that repeats the opening.
- Restating what the diff already shows ("This changes the function to...").
- Hedge-stacking: "essentially", "fundamentally", "simply", "just", "basically".
- Em-dash chains and "not X, it's Y" contrast pairs (the Core Rules catch these; they are especially glaring in a short comment).
