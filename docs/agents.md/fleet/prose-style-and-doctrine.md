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
- **Write like a decisive, generous maintainer.** State the proposal or answer,
  name the concrete reason, then give the next action. For a breaking or
  architectural decision, name the migration path and ask focused stakeholders
  when their code or users are affected.
- **Keep directness readable.** Write complete sentences. Explain the
  non-obvious mechanism before requesting a change, at a junior-developer level;
  cite the code, a small snippet, or a link rather than relying on jargon.
- **No structure for its own sake.** Don't impose Summary/Changes/Testing headers
  on a PR a sentence describes. Use a list only when N parallel items genuinely
  exist.
- **The maintainer's own voice is in scope.** When the agent writes AS the
  primary author — a PR/issue comment, a Linear update, or any prose posted on
  their behalf — the anti-patterns below (especially honesty framing) apply to
  that voice too. Writing in someone's voice is no license to add filler they
  would not.

## Idioms and sayings — encouraged

The anti-slop bans target AI-writing tells, NOT human color. A well-placed
saying is the opposite of slop: it compresses a judgment into shared
vocabulary. Lean Gen X / late-millennial: working-life and gaming idiom over
corporate or internet-meme registers.

<details>
<summary><b>Detail</b> — the full list (8 entries)</summary>

- **The idiom decorates a plain claim, never replaces it.** "The guard-event
  log is already earning its keep — it flagged two retry-suspects this week"
  works because the receipt is right there. An idiom with no fact behind it is
  filler with better shoes.
- **One per thought.** A saying lands because it's the only one in the
  paragraph. Three stacked reads as performance, not voice.
- **Anchor the obscure ones.** If a non-native reader would need to decode it,
  put the plain meaning in the same sentence.
- **Where they belong:** PR bodies and comments, issue threads, commit
  BODIES, docs prose, this doc. **Where they don't:** commit subjects (the
  Conventional Commits format owns those), error messages (What/Where/Saw/Fix
  owns those), API reference, identifiers.
- **A saying is no smuggling route.** Every entry in the anti-pattern lists
  below and in `.claude/skills/fleet/prose/references/phrases.md` stays banned even when it is
  idiomatic — the sincerity announcements and the business-jargon list most of
  all.

A working set, by register (grow it — the point is a voice, not a whitelist):

- **Craft / working life (Gen X):** earning its keep · doing the heavy lifting ·
  load-bearing · paying for itself · not my first rodeo · kick the tires ·
  under the hood · table stakes · duct tape and prayers · the juice isn't
  worth the squeeze · smoking gun · canary in a coal mine · burying the lede ·
  in the weeds · rabbit hole · off the rails · dumpster fire · sticks the
  landing · closes the loop · ship it
- **Dev-culture (evergreen):** footgun · happy path · yak shaving ·
  bikeshedding · phones home · fail loud · banked (work that survives a crash)
  · steel-man · word-golf (rewording around a guard — fleet coinage, use it)
- **Late-millennial / gaming:** side quest · boss fight · cheat code · level
  up · speedrun · receipts (evidence — already doctrine) · living rent-free ·
  chef's kiss · big &lt;X&gt; energy · full-circle moment · on brand · vibe
  check (sparingly) · galaxy-brain (pejorative: over-clever)

</details>

## Anti-patterns (both modes)

Blocked by `anti-prose-guard` on doc writes; flagged by
`convo-prose-nudge` on `gh pr/issue` commands:

<details>
<summary><b>The banned patterns</b> - throat-clearers, closing filler, hedge-stacking, em-dashes, contrast pairs, self-vouching framing, and the AI-slop tells</summary>

- Throat-clearers: "I've gone ahead and…", "Let me…", "In this PR, I…",
  "I took a look and…"
- Closing filler: "Let me know if you have any questions!", "Hope this helps!",
  trailing summary restating the opening.
- Hedge-stacking: "essentially", "fundamentally", "simply", "just", "basically".
- Em-dashes, every one of them. Not "no chains", none at all: one U+2014 on an
  outbound surface already reads as an agent tell. The fix is mechanical, so it
  stays reviewable: replace the em-dash with a plain hyphen and leave the
  spacing alone, so ` — ` becomes ` - `. A dash inside a code span or a fenced
  block is exempt, because there it is quoted code rather than prose. Gated by
  `scripts/fleet/check/prose-em-dashes-are-absent.mts`, whose `--fix` applies
  the swap and whose burn-down list in
  `scripts/fleet/constants/prose-em-dash-burn-down.json` names the files still
  owed the rewrite and only ever shrinks.
- "not X, it's Y" contrast pairs — state the positive directly.
- Honesty framing: the bare word ("honest", "honestly", "honesty"), "in all
  honesty", "to be honest", "if I'm honest", "Frankly," — just state the claim.
  Claiming honesty implies the rest is not. This is a CATEGORICAL ban, not a
  heuristic: one matcher (`.claude/hooks/fleet/_shared/honesty-framing.mts`) backs all three
  enforcers, so the rule fires the same on chat, `gh` bodies, and doc writes.
  A warranted adverbial use is rare; the per-surface bypass phrase covers it.
- AI-slop tells (purple-prose words like delve/tapestry, importance puffery,
  weasel attribution, colon reveals, faux-insight, summary-recap): the shared
  `.claude/hooks/fleet/_shared/ai-slop-patterns.mts` matcher backs all three enforcers, the same
  DRY model as the honesty matcher. The full banned-word + pattern set with
  fixes lives in the prose skill's `.claude/skills/fleet/prose/references/phrases.md`; run human-facing
  prose through it.

</details>

## Operating doctrine

- **Decide fast; state the reason + reversal condition.** Don't survey options.
  Decide, name why, name what would change it, move.
- **Use `<details>` only when GitHub prose has supporting evidence, alternatives,
  migration notes, or a multi-item plan.** Keep the decision outside the fold and
  use a specific summary. A one-line or 1-3 sentence reply stays flat.
- **Four rules govern the inside of a fold** — `scripts/fleet/_shared/pr-body-law.mts`
  states them as data (`PR_BODY_LAW`, `PR_BODY_LAW_PROMPT`) and `prBodySmells()`
  reports the shapes advisorily:
  - **The summary carries the claim.** Short bold noun phrase, a spaced plain
    dash, specific finding, so the reader decides whether to expand without
    expanding. `What changed` fails; `The change - one home per case, plus the
    vars that outrank it` passes. The separator is ` - ` and nothing else, the
    one spelling the corpus converges on: a colon reads as a label and an
    em dash is banned outright by the rule above. `CLAIM_SEPARATOR_RE` still
    accepts the older spellings on read, so nothing already written breaks.
  - **Open with the takeaway, then support it.** Lead-with-the-point, one level
    down. A fold opening on a list or a code fence leaves the reader to assemble
    the point.
  - **Enumerable facts are a table.** Three or more parallel items with a shared
    shape get two columns (`variable | what leaks without it`); each row then has
    room for its own caveat. Seven of them in a paragraph is unreadable.
  - **Status sections use labeled lines.** **Ran** / **Did not run** /
    **Trade-off** / **CI is unaffected**, so a reviewer asking only "did they
    actually test this" finds it instantly.
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
| `anti-prose-guard` | Blocks doc/CHANGELOG/README writes with AI tells, including the framing-word ban from Anti-patterns above |
| `convo-prose-nudge` | Nudges `gh pr/issue` body commands with AI scaffolding |
| `changelog-entry-shape-nudge` | Nudges a `CHANGELOG.md` entry bullet that links no detail into a `docs/agents.md/` topic doc |
| `no-description-aside-guard` | Blocks a package manifest `description` field ending in a listy parenthetical aside |
| `prose-code-format-nudge` | Nudges a bare software identifier in prose (e.g. `rustls`) that should be a code span |
| `scripts/fleet/_shared/pr-body-law.mts` | The four in-fold rules as importable data, plus `prBodySmells()` — advisory, deliberately unwired from any gate until it is proven false-positive-free on real bodies |
| `prose` skill | Applies both modes when drafting/editing any human-facing text |
| `.claude/rules/fleet/prose-style-and-doctrine.md` | Compact reference for the skill + rule docs |

See also: `.claude/skills/fleet/prose/SKILL.md`,
`.claude/skills/fleet/prose/references/conversational.md`.
