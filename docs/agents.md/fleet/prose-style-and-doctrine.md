# Prose style and doctrine

Fleet prose follows two modes — **conversational** (PR bodies, issue comments,
Linear updates, commit bodies) and **documentation** (`docs/`, README, CHANGELOG,
release notes). Both modes strip AI-writing antipatterns. Conversational mode
adds brevity and directness on top.

## Surface routing

| Surface | Mode |
| --- | --- |
| PR description/comment, issue body/comment, Linear, commit body | Conversational |
| `docs/**`, `README.md`, `CHANGELOG.md`, release notes, API reference | Documentation |
| Cascade commits, bot output | Exempt |

## Conversational mode rules

- **Lead with the point.** First sentence = the decision, finding, or answer.
  No preamble, no "Thanks for the report", no restating the task.
- **Default to 1-3 sentences.** A comment that could be one line should be one
  line. Cut anything the reader already knows.
- **Show the receipt.** Every technical claim needs evidence from this session:
  a commit SHA, a `file:line` reference, a benchmark line. Never assert
  "faster/works/fixed" without a tool call that produced the result.
- **Code beats prose** when the answer is code — paste the snippet, not a
  paragraph about it.
- **Ask when collaborating.** "What do you think?" pulls people in. Credit good
  work plainly.
- **No structure for its own sake.** Don't impose Summary/Changes/Testing headers
  on a PR a sentence describes. Use a list only when N parallel items genuinely
  exist.
- **The maintainer's own voice is in scope.** When the agent writes AS the
  primary author — a PR/issue comment, a Linear update, or any prose posted on
  their behalf — the anti-patterns below (especially honesty framing) apply to
  that voice too. Writing in someone's voice is no license to add filler they
  would not.

## Anti-patterns (both modes)

Blocked by `anti-prose-guard` on doc writes; flagged by
`convo-prose-nudge` on `gh pr/issue` commands:

- Throat-clearers: "I've gone ahead and…", "Let me…", "In this PR, I…",
  "I took a look and…"
- Closing filler: "Let me know if you have any questions!", "Hope this helps!",
  trailing summary restating the opening.
- Hedge-stacking: "essentially", "fundamentally", "simply", "just", "basically".
- Em-dash chains (more than one per sentence).
- "not X, it's Y" contrast pairs — state the positive directly.
- Honesty framing: the bare word ("honest", "honestly", "honesty"), "in all
  honesty", "to be honest", "if I'm honest", "Frankly," — just state the claim.
  Claiming honesty implies the rest is not. This is a CATEGORICAL ban, not a
  heuristic: one matcher (`_shared/honesty-framing.mts`) backs all three
  enforcers, so the rule fires the same on chat, `gh` bodies, and doc writes.
  A warranted adverbial use is rare; the per-surface bypass phrase covers it.

## Operating doctrine

- **Decide fast; state the reason + reversal condition.** Don't survey options.
  Decide, name why, name what would change it, move.
- **Verify before claiming.** Subagent output counts and file lists are leads, not
  facts — grep/read before relaying.
- **Finish the task; capture side-quests.** Don't chase tangents — note them and
  ask, then continue on the stated task.
- **A standard that isn't executable is policy on paper.** A correction heard once
  → promote to a hook, lint rule, or check script.
- **Default to the high-bar invariant when unsure.** Quality is the baseline.

## Enforcement

| Layer | What |
| --- | --- |
| `anti-prose-guard` | Blocks doc/CHANGELOG/README writes with AI tells |
| `convo-prose-nudge` | Nudges `gh pr/issue` body commands with AI scaffolding |
| `prose` skill | Applies both modes when drafting/editing any human-facing text |
| `.claude/rules/fleet/prose-style-and-doctrine.md` | Compact reference for the skill + rule docs |

See also: `.claude/skills/fleet/prose/SKILL.md`,
`references/conversational.md`.
