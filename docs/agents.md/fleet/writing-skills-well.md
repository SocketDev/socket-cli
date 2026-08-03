# Writing skills well

How to author a fleet skill that's **predictable** — the agent taking the same
*process* every run, not producing the same output. Predictability is the root
virtue; every lever here serves it. Read this before adding a skill under
`.claude/skills/fleet/`; pair it with [`agents-and-skills.md`](agents-and-skills.md)
(taxonomy, naming, scope) and [`code-is-law`](code-is-law.md).

Adapted from `mattpocock/skills/writing-great-skills`.

## The fleet step shape: script first, AI residue

This is the fleet's defining adaptation. Every skill step that has a
deterministic script equivalent **defers to that script**; the AI step owns only
the **residue** the script can't resolve. This is the
[`code-first-then-ai`](../../../.claude/rules/fleet/code-first-then-ai.md) rule
applied to skill structure: `ai-lint-fix` runs `lint --fix` first and spawns AI
only for the custom `socket/*` rules oxlint can't autofix. A skill that hand-walks
the agent through something a `.mts` already does is the anti-pattern the
`defer-to-script-nudge` hook flags. Skills/commands/agent docs are **thin
wrappers** — the heavy lifting lives in a backing `node scripts/.../*.mts`.

## Invocation: model-invoked vs user-invoked

Two choices, trading different costs:

- **Model-invoked** keeps a `description`, so the agent fires it autonomously and
  other skills can reach it. It costs **context load** — the description sits in
  every turn's window fleet-wide. Use only when the agent must reach it on its own.
- **User-invoked** (`disable-model-invocation: true`) strips the description from
  the agent's reach: zero context load, but it spends **cognitive load** (you must
  remember it exists). Make a skill user-invoked when it only ever fires by hand.

The fleet runs lean on context; default to the cheaper option. A reference-only
authoring doc like this one lives in `docs/agents.md/fleet/` (loaded on demand),
**not** an always-loaded `.claude/rules/fleet/` file — putting rarely-needed
reference in the always-loaded tier is itself a no-op tax on every session.

## Information hierarchy

A skill mixes two content types — **steps** (ordered actions in `SKILL.md`) and
**reference** (facts consulted on demand). Rank each by how immediately the agent
needs it:

1. **In-skill step** — what the agent does, in order. Each ends on a
   **completion criterion**: the checkable condition that says the work is done.
   Make it checkable (can the agent tell done from not-done?) and, where it
   matters, exhaustive ("every modified file lint-clean", not "fix the lint") — a
   vague criterion invites **premature completion**.
2. **In-skill reference** — a rule or fact in `SKILL.md`, consulted on demand.
3. **External reference** — pushed out into a linked file (`reference.md`), reached
   by a **context pointer**, loaded only when the pointer fires.

**Progressive disclosure** is the move down the ladder so the top stays legible.
Inline what every **branch** — a distinct path through the skill — needs; push behind
a pointer what only some branches reach. **Co-location**: keep a concept's
definition, rules, and caveats under one heading so reading one part brings its
neighbours.

## Leading words

A **leading word** is a compact concept already in the model's pretraining that
the agent thinks with while running the skill (`tight`, `red`, `residue`, `tracer
bullet`). It anchors a region of behaviour in the fewest tokens by recruiting
priors the model holds. Fleet leading words worth reaching for:

- `tight` — a fast, deterministic, low-overhead loop: a *tight* feedback loop.
- `red` — a loop that goes *red* on this bug; converts a fuzzy gate to a binary
  observable.
- `residue` — the part a script can't do; what AI owns after the deterministic
  pass.
- `cascade` / `dogfood` — fleet propagation verbs with fixed meaning.

Hunt for restatements a leading word retires: "fast, deterministic, low-overhead"
→ *tight*. You win twice — fewer tokens and a sharper hook.

## Pruning

- **Single source of truth** — one authoritative place per meaning; changing
  behaviour is a one-place edit. (Fleet-wide: rosters/pins/pricing in one canonical
  file — see [`single-source-of-truth`](single-source-of-truth.md).)
- **Relevance** — does each line still bear on what the skill does?
- **No-ops** — hunt sentence by sentence: does this line change behaviour versus
  the agent's default? "Be thorough" when the agent is already thorough-ish is a
  no-op; the fix is a stronger word (`relentless`), not more words. Delete the
  whole sentence, don't trim it.

## Voice

A skill's prose is a fleet surface: it follows
[`prose-style-and-doctrine`](../../../.claude/rules/fleet/prose-style-and-doctrine.md)
— lead with the point, decide fast and name the reversal condition, cut hedges and
throat-clearers, evidence over assertion. A skill that reads like marketing copy
spends tokens without changing behaviour.

## Failure modes

- **Premature completion** — ending a step before it's done. Sharpen the
  completion criterion first (cheap); only if it's irreducibly fuzzy *and* you see
  the rush, split the sequence to hide post-completion steps.
- **Duplication** — the same meaning in more than one place; costs maintenance,
  tokens, and inflates a meaning's rank.
- **Sediment** — stale layers that settle because adding feels safe and removing
  feels risky. The default fate of any skill without a pruning discipline.
- **Sprawl** — a skill too long even when every line is live. Cure with the ladder:
  disclose reference behind pointers, split by branch or sequence.
- **No-op** — a line the model already obeys by default; load paid to say nothing.
