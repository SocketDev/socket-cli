---
name: prose
description: Removes AI writing patterns from prose. Use when drafting, editing, or reviewing essays, blog posts, docs, release notes, commit message bodies, PR descriptions, CHANGELOG entries, README content, or any human-facing text that reads AI-generated: hedged, metronomic, padded with throat-clearing, or full of em-dashes, adverbs, and "not X, it's Y" contrasts.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep
model: claude-sonnet-4-6
context: fork
---

# prose

Eliminate AI writing patterns from prose.

Hardik Pandya wrote the upstream version (`stop-slop`). MIT-licensed. Source: https://github.com/hardikpandya/stop-slop. Core rules + references run verbatim. Edit only in `socket-wheelhouse/template/`; the cascade refreshes downstream copies.

Fleet doctrine (voice, evidence standard, anti-patterns, surface routing) is codified in `.claude/rules/fleet/prose-style-and-doctrine.md` and `docs/agents.md/fleet/prose-style-and-doctrine.md`. Both are loaded by the skill; future skills (to-pr, to-tickets, to-spec) reuse the same reference.

## Fleet surfaces — two modes

This skill runs in two modes. Both strip the AI-slop the Core Rules target; the conversational mode adds brevity + voice on top.

**Route by surface:**

- Targeting a `docs/**` file, README, CHANGELOG, GitHub Release notes, or API-reference prose → **documentation mode** (the Core Rules below, unchanged).
- Targeting a PR description / comment (`gh pr create/edit/comment --body`), an issue body or reply (`gh issue create/comment`), a review comment, a Linear issue/comment, a status summary, or a multi-paragraph commit *body* → **conversational mode**: the Core Rules **plus** [references/conversational.md](references/conversational.md) (lead with the point, be brief, show the receipt, drop the AI scaffolding).

**Documentation mode applies to:**

- CHANGELOG entries, README sections, `docs/` markdown, GitHub Release notes, API-reference prose. Complete + precise + durable; length serves correctness.
- Code-format bare library/tool names in prose (e.g. `rustls`, `rolldown`, `reqwest`) — they read as code, not prose. The `prose-code-format-nudge` hook flags them on `*.md` edits, off a shared dictionary (`.claude/hooks/fleet/_shared/known-names.mts`) derived from the repo's own manifests; that lib is the single source of truth for this check.

**Conversational mode applies to:**

- PR descriptions + comments, issue bodies + replies, review comments, Linear issues/comments, status summaries, and multi-paragraph commit bodies. Land the point now, to a person; length serves the point (often 1–3 sentences). Commit subject lines stay terse + imperative per `commit-message-format-guard` (not this skill).

## When to skip this skill

- Code, code comments, or structured data.
- JSON, YAML, TOML.
- `chore(wheelhouse): cascade template@<sha>` commits. sync-scaffolding generates them with a fixed shape.
- Bot output: Dependabot PRs, release auto-notes from PR titles.
- Transcripts and direct quotes (preserve voice verbatim).
- API reference prose where precision matters more than rhythm.

## Instructions

1. Apply the Core Rules to every paragraph, in order.
2. Run the Quick Checks on the full draft.
3. Score with the Scoring table; if it totals below 35/50, revise and re-score.
4. Stop when the draft reads like a person wrote it. Further edits risk over-polishing.

If an edit changes meaning or loses the author's voice, revert it. Never rewrite a direct quote.

## Core Rules

1. **Cut filler phrases.** Remove throat-clearing openers, emphasis crutches, and all adverbs. See [references/phrases.md](references/phrases.md).

2. **Break formulaic structures.** Avoid binary contrasts, negative listings, dramatic fragmentation, rhetorical setups, false agency. See [references/structures.md](references/structures.md).

3. **Use active voice.** Every sentence needs a human subject doing something. No passive constructions. No inanimate objects performing human actions ("the complaint becomes a fix").

4. **Be specific.** No vague declaratives ("The reasons are structural"). Name the specific thing. No lazy extremes ("every," "always," "never") doing vague work.

5. **Put the reader in the room.** No narrator-from-a-distance voice. "You" beats "People." Specifics beat abstractions.

6. **Vary rhythm.** Mix sentence lengths. Two items beat three. End paragraphs differently. No em dashes.

7. **Trust readers.** State facts directly. Skip softening, justification, hand-holding.

8. **Cut quotables.** If it sounds like a pull-quote, rewrite it.

## Quick Checks

Before delivering prose:

- Any adverbs? Kill them.
- Any passive voice? Find the actor, make them the subject.
- Inanimate thing doing a human verb ("the decision emerges")? Name the person.
- Sentence starts with a Wh- word? Restructure it.
- Any "here's what/this/that" throat-clearing? Cut to the point.
- Any "not X, it's Y" contrasts? State Y directly.
- Three consecutive sentences match length? Break one.
- Paragraph ends with punchy one-liner? Vary it.
- Em-dash anywhere? Remove it.
- Vague declarative ("The implications are significant")? Name the specific implication.
- Narrator-from-a-distance ("Nobody designed this")? Put the reader in the scene.
- Meta-joiners ("The rest of this essay...")? Delete. Let the essay move.

## Scoring

Rate 1-10 on each dimension:

| Dimension    | Question                      |
| ------------ | ----------------------------- |
| Directness   | Statements or announcements?  |
| Rhythm       | Varied or metronomic?         |
| Trust        | Respects reader intelligence? |
| Authenticity | Sounds human?                 |
| Density      | Anything cuttable?            |

Below 35/50: revise.

## Example

**Before:**

```
Here's the thing: building products is hard. Not because the
technology is complex. Because people are complex. Let that sink in.
```

**After:**

```
Building products is hard. Technology is manageable. People aren't.
```

Removed the opener, the binary contrast, and the emphasis crutch. Two direct statements, same meaning.

See [references/examples.md](references/examples.md) for more.

## Edge cases

- **Direct quotes**: leave them alone; quoting a hedging speaker verbatim is not slop.
- **Technical prose where precision > rhythm**: API reference sentences can be metronomic; don't force variation that loses accuracy.
- **Lists and tables**: structural repetition is the point; don't "vary rhythm" inside a parameter list.
- **First-person personal voice**: `you`/`I` is fine; don't strip writer presence in the name of directness.
