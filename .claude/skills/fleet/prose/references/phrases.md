# Phrases to Remove

## Contents

- Throat-Clearing Openers
- Emphasis Crutches
- Business Jargon
- Banned Words
- Adverbs
- Meta-Commentary
- Performative Emphasis
- Telling Instead of Showing
- Vague Declaratives
- Importance Puffery
- Weasel Attribution
- Fake-Strong Verbs
- Colon Reveals
- Superficial Analysis
- Synonym Cycling
- Negative Listing and Dramatic Fragmentation
- Fake-Profound Kickers
- Summary-Recap Endings
- Email Pleasantries
- Letter Announcements

The prose skill checks drafts against every entry here. The near-zero-false-
positive subset (purple-prose words, importance puffery, weasel attribution,
colon reveals, faux-insight, summary-recap) is also enforced at write time by
the shared `_shared/ai-slop-patterns.mts` matcher, which anti-prose-guard,
convo-prose-nudge, and reply-prose-nudge all import. One source, every surface.

## Throat-Clearing Openers

Remove these announcement phrases. State the content directly.

- "Here's the thing:"
- "Here's what [X]"
- "Here's this [X]"
- "Here's that [X]"
- "Here's why [X]"
- "The uncomfortable truth is"
- "It turns out"
- "The real [X] is"
- "Let me be clear"
- "The truth is,"
- "I'll say it again:"
- "I'm going to be honest"
- "Can we talk about"
- "Here's what I find interesting"
- "Here's the problem though"

Any "here's what/this/that" construction is throat-clearing before the point. Cut it and state the point.

## Emphasis Crutches

These add no meaning. Delete them.

- "Full stop." / "Period."
- "Let that sink in."
- "This matters because"
- "Make no mistake"
- "Here's why that matters"

## Business Jargon

Replace with plain language.

| Avoid                 | Use instead            |
| --------------------- | ---------------------- |
| Navigate (challenges) | Handle, address        |
| Unpack (analysis)     | Explain, examine       |
| Lean into             | Accept, embrace        |
| Landscape (context)   | Situation, field       |
| Game-changer          | Significant, important |
| Double down           | Commit, increase       |
| Deep dive             | Analysis, examination  |
| Take a step back      | Reconsider             |
| Moving forward        | Next, from now         |
| Circle back           | Return to, revisit     |
| On the same page      | Aligned, agreed        |

## Banned Words

Never use these. Each is an AI-slop tell; use the plain word the sentence needs.

delve, foster, leverage, utilize, facilitate, empower, streamline, robust,
cutting-edge, paradigm shift, tapestry, realm, beacon, multifaceted, meticulous,
intricate, paramount, transformative, elevate, embark, supercharge, harness,
ever-evolving.

## Adverbs

Kill all adverbs. No -ly words. No softeners, no intensifiers, no hedges.

Specific offenders:

- "really"
- "just"
- "literally"
- "genuinely"
- "honestly"
- "simply"
- "actually"
- "deeply"
- "truly"
- "fundamentally"
- "inherently"
- "inevitably"
- "interestingly"
- "importantly"
- "crucially"

Also cut these filler phrases:

- "At its core"
- "In today's [X]"
- "It's worth noting"
- "At the end of the day"
- "When it comes to"
- "In a world where"
- "The reality is"

## Meta-Commentary

Remove self-referential asides. The essay should move, not announce its own structure.

- "Hint:"
- "Plot twist:" / "Spoiler:"
- "You already know this, but"
- "But that's another post"
- "X is a feature, not a bug"
- "Dressed up as"
- "The rest of this essay explains..."
- "Let me walk you through..."
- "In this section, we'll..."
- "As we'll see..."
- "I want to explore..."

## Performative Emphasis

False intimacy or manufactured sincerity:

- "creeps in"
- "I promise"
- "They exist, I promise"

## Telling Instead of Showing

Announcing difficulty or significance rather than demonstrating it:

- "This is genuinely hard"
- "This is what leadership actually looks like"
- "This is what X actually looks like"
- "actually matters"

## Vague Declaratives

Sentences that announce importance without naming the specific thing. Kill these.

- "The reasons are structural"
- "The implications are significant"
- "This is the deepest problem"
- "The stakes are high"
- "The consequences are real"

If a sentence says something is important/deep/structural without showing the specific thing, cut it or replace it with the specific thing.

## Importance Puffery

State the fact and let the reader judge whether it matters.

- "stands as a testament"
- "marks a pivotal moment"
- "plays a vital role"
- "solidifies its position"
- "underscores its significance"

## Weasel Attribution

Name the source or cut the claim. If there is no source, ask; never invent one.

- "experts agree"
- "studies show"
- "industry reports suggest"
- "many argue"
- "widely regarded as"

## Fake-Strong Verbs

Prefer "is" and "has" when they are clearer, and swap weak verb phrases for
direct verbs.

- "serves as a centralized hub for" (name what it does: "tracks X, Y, Z in one place")
- "made a decision" (say "decided")
- "has the ability to" (say "can")

## Colon Reveals

A noun phrase, a colon, then a dramatic reveal. Rewrite as a plain sentence. Use
colons for lists, labels, and quotes, not fake drama.

- "The best part: it learns."
- "The detail that makes it work: a separate agent grades it."

## Superficial Analysis

Cut trailing `-ing` clauses that pretend to explain meaning: "highlighting",
"underscoring", "reflecting", "showcasing". State the concrete consequence
instead.

- "adds file search, highlighting the team's commitment to workflows" (say "adds file search, so users find old drafts without leaving the editor")

## Synonym Cycling

Repeat the clear word; do not rotate terms for style.

- "The agent reviews the draft. The assistant scores it. The tool suggests fixes." (say "The agent reviews the draft, scores it, and suggests fixes.")

## Negative Listing and Dramatic Fragmentation

- Negative listing: "Not a X. Not a Y. A Z." Just say Z.
- Dramatic fragmentation: "X. And Y. And Z." / "That's it. That's the whole thing." Use complete sentences.

## Fake-Profound Kickers

Delete the final "deep" line that turns the point into a metaphor, aphorism, or
mic-drop. Do not rewrite it into a better metaphor. End on the clearest concrete
sentence already present, or add a plain takeaway or next action.

## Summary-Recap Endings

Cut "In conclusion", "Ultimately", "Overall", and any final paragraph that
restates the piece. The reader was just there. End on the last concrete point,
takeaway, or next action.

## Email Pleasantries

- "I hope this email finds you well"
- "I hope you're doing well"
- "I hope all is well"

## Letter Announcements

- "I am writing this letter..."
- "I am writing to inform you..."
- "Writing this to inform you..."
- "I wanted to reach out..."
