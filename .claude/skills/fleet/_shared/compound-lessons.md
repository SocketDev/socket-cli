# Compound lessons

How a fleet skill or review turns a finding into a durable rule, instead of fixing it once and forgetting.

## The principle

Each unit of engineering work should make subsequent units **easier**, not harder. A bug fix that doesn't update the rule that allowed the bug is a half-finished job: the next change in the same area will hit the same class of bug, and the cycle repeats.

Three places a lesson can land in this fleet:

| Where                       | When                                                                   | Effect                                                  |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| **CLAUDE.md fleet rule**    | The mistake recurs across repos or is a fleet-wide invariant           | Every fleet repo inherits the rule on next sync         |
| **`.claude/hooks/*` block** | The mistake is mechanical and can be detected from tool input/output   | Hook blocks the next attempt before the file is written |
| **Skill prompt update**     | The mistake is judgment-shaped (review pass missed a class of finding) | Future runs of that skill catch the variant             |

## When to compound

Compound a lesson **only** when one of these is true:

1. **Recurrence** — the same kind of bug has now appeared 2+ times. Write down the rule that would have caught both.
2. **High blast radius** — the bug shipped, broke a downstream user, or required a revert. The rule prevents the next shipping incident.
3. **Drift signal** — fleet repos disagreed on the answer. The rule reconciles which answer wins.

Don't compound for one-off fixes that won't recur. Don't write a "lesson" doc when the lesson is just "we fixed it." The fleet rule **is** the lesson; if you can't crystallize it into a rule, the lesson isn't ready.

## How to compound

1. **Name the rule** — one sentence, imperative voice. "Never X." "Always Y."
2. **Cite the motivating case generically** — one-line `**Why:**` line stating the _shape_ of the problem the rule prevents, framed as a timeless example. NOT a dated incident log: no ISO dates, version deltas, percentages, or commit SHAs — those age into a changelog and leak detail in a fleet-duplicated file. ✗ "**Why:** 2026-06-07 pnpm 11.0.0 vs 11.5.1 broke the cascade at SHA abc1234" → ✓ "**Why:** a stale pnpm on PATH fails the version check and aborts the cascade install." (Enforced: `dated-citation-guard` at edit time + `scripts/fleet/check/rule-citations-are-generic.mts` in `check --all`.)
3. **State the application** — one-line `**How to apply:**` line saying when the rule fires.
4. **Land it where it'll fire** — CLAUDE.md, hook, or skill prompt. Pick the lowest-friction surface that catches the next occurrence. When the discipline is a procedure (a cascade, a reconcile, a bump), the lowest-friction surface is an **executable** `.mts` / saved Workflow — the law is code that runs identically for a human and an agent; the CLAUDE.md rule, hook, and skill are the explanatory + enforcing layer ON TOP. Don't stop at prose for something a script could do. The **`codifying-disciplines`** skill automates steps 1–4: it scans for uncodified disciplines (including mined from memory), picks the surface, and routes authoring through the **`ai-codify`** orchestrator (`scripts/fleet/ai-codify/cli.mts`) — tier-matched model/effort per surface, with the mandatory test. Run it when the **`uncodified-lesson-nudge`** hook nudges that a lesson landed without an enforcer.

Skip the retrospective doc. Skip the post-mortem template. The rule is the artifact.

## Anti-patterns

- **The "lessons learned" graveyard** — a `docs/lessons/` folder where dated markdown files rot. Don't. The rule belongs in the live config that fires on the next run.
- **Vague rules** — "be careful with X." Useless. If you can't write the rule as a `rg` pattern or a CLAUDE.md `🚨` line, it isn't a rule yet.
- **Rules without why** — future readers can't judge edge cases without the motivating case. Always cite it — generically, as the problem shape, never a dated log.
- **Dated incident logs as rationale** — `**Why:** 2026-06-07 …`. The date/version/SHA is dead weight the moment the versions move; write the timeless example instead.

## Source

Borrowed from Every Inc.'s _Compound Engineering_ playbook (https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents). Their `/ce-compound` slash command is the verb form of this principle; we encode the same discipline as a fleet convention rather than a slash command.
