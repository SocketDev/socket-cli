# Compound lessons

How a fleet skill or review turns a finding into a durable rule, instead of fixing it once and forgetting.

## The principle

Each unit of engineering work should make subsequent units **easier**, not harder. A bug fix that doesn't update the rule that allowed the bug is a half-finished job: the next change in the same area will hit the same class of bug, and the cycle repeats.

Three places a lesson can land in this fleet:

| Where | When | Effect |
|---|---|---|
| **CLAUDE.md fleet rule** | The mistake recurs across repos or is a fleet-wide invariant | Every fleet repo inherits the rule on next sync |
| **`.claude/hooks/*` block** | The mistake is mechanical and can be detected from tool input/output | Hook blocks the next attempt before the file is written |
| **Skill prompt update** | The mistake is judgment-shaped (review pass missed a class of finding) | Future runs of that skill catch the variant |

## When to compound

Compound a lesson **only** when one of these is true:

1. **Recurrence** — the same kind of bug has now appeared 2+ times. Write down the rule that would have caught both.
2. **High blast radius** — the bug shipped, broke a downstream user, or required a revert. The rule prevents the next shipping incident.
3. **Drift signal** — fleet repos disagreed on the answer. The rule reconciles which answer wins.

Don't compound for one-off fixes that won't recur. Don't write a "lesson" doc when the lesson is just "we fixed it." The fleet rule **is** the lesson; if you can't crystallize it into a rule, the lesson isn't ready.

## How to compound

1. **Name the rule** — one sentence, imperative voice. "Never X." "Always Y."
2. **Cite the incident** — one-line `**Why:**` line referencing the commit, PR, or finding. Don't write a paragraph.
3. **State the application** — one-line `**How to apply:**` line saying when the rule fires.
4. **Land it where it'll fire** — CLAUDE.md, hook, or skill prompt. Pick the lowest-friction surface that catches the next occurrence.

Skip the retrospective doc. Skip the post-mortem template. The rule is the artifact.

## Anti-patterns

- **The "lessons learned" graveyard** — a `docs/lessons/` folder where dated markdown files rot. Don't. The rule belongs in the live config that fires on the next run.
- **Vague rules** — "be careful with X." Useless. If you can't write the rule as a `rg` pattern or a CLAUDE.md `🚨` line, it isn't a rule yet.
- **Rules without why** — future readers can't judge edge cases without the original incident. Always cite.

## Source

Borrowed from Every Inc.'s _Compound Engineering_ playbook (https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents). Their `/ce-compound` slash command is the verb form of this principle; we encode the same discipline as a fleet convention rather than a slash command.
