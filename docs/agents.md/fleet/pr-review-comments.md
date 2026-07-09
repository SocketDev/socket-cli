# PR review comments

Every PR review comment an agent posts follows one format so a reader can
triage it at a glance: severity-sorted fold-outs, hover-explained priority
circles, and prose a junior developer can follow without decoding jargon.
`node scripts/fleet/lint-pr-comment.mts <draft.md>` validates the mechanical
rules before the comment is posted; the judgment rules below it are checked by
the author.

## Mechanical rules (validated by `lint-pr-comment.mts`)

- **One `<details>` block per major finding.** The `<summary>` is a bolded
  one-line title that makes sense on its own; smaller items share one trailing
  block.
- **Severity circle on every summary**, wrapped in `<abbr>` hover text with the
  canonical label:
  - 🔴 `Critical: fix before merge/run`
  - 🟠 `Significant: should be addressed`
  - 🟡 `Moderate/minor: worth addressing`
  - 🟢 `Verified fine / informational`
- **Sections sorted most-severe first** — 🔴, then 🟠, 🟡, and 🟢 last.
  Numbered titles follow the sorted order (1, 2, 3, …). Verified-fine notes
  become a trailing 🟢 section, not intro prose.
- **Numeric references carry their title.** "item 1" / "finding 3" is always
  followed by the item's short title in italics: `item 1 _(list-route
  threshold)_`. Never make the reader scroll to decode a number.
- **No intra-comment links or anchors.** GitHub cannot open (or scroll to) a
  fragment inside a collapsed `<details>`, so fold-out links are dead on
  arrival. Findings live in their `<details>` blocks; there is no intro
  enumeration linking to them — the severity circles carry the map, and
  numeric references stay plain `item N _(title)_`.
- **Fold-out bodies are indented.** The body of every `<details>` block is
  wrapped in `<blockquote>` (opened on the line after `</summary>`, closed on
  the line before `</details>`) so the expanded content renders indented
  under its summary instead of flush with it.
- **Suggested remediations are labeled `Fix idea 💡:`** — always with the bulb.
- **Smaller-items bullets carry their own circles.** Inside the trailing
  "Smaller items" fold, each bullet starts with its own `<abbr>`-wrapped
  circle, and the fold's summary circle matches the most severe bullet inside.
  A smaller item is never 🔴 — anything critical is promoted to its own
  section.
- **No AI attribution** — this is a GitHub prose surface; the fleet-wide ban
  applies.

## Judgment rules (author-checked, not mechanically validatable)

- **Junior-dev comprehension.** Explain the mechanism before the problem (what
  the table/hook/counter does), walk failure scenarios step by step, spell out
  abbreviations (`getServerSideProps`, not SSP), and replace jargon with what
  actually happens ("the loop never converges" → "every re-scan re-processes
  them for nothing").
- **Complete, easy sentences.** No fragments, no arrow chains, at most one
  em-dash per sentence.
- **Verified findings only.** Adversarially verify candidates first; refuted
  candidates never get posted. Cite file/function names as receipts.
- **Attribute or verify a self-report; don't restate it as fact.** When a PR
  author or bot says "I ran X" / "my machine is on 1.15.7" / "N tests pass",
  that's their claim, not your finding. Verify the part you can read (the repo
  pin, the diff, a tool call) and attribute the part you can't ("you mentioned
  your local is 1.15.7") — a checkable half doesn't verify the unverifiable
  half. Applies especially to "check his work" replies.
- **Never repeat a bot's feedback.** Before posting, fetch the PR's existing
  reviews and inline comments (Cursor Bugbot, Copilot, github-actions) and drop
  any finding they already made; say so when skipping one.
- **Detect duplicate PRs first.** Search open PRs (title/body keywords + the
  Linear ref) for an already-open PR doing the same thing; report duplicates to
  the requester rather than reviewing both blind.
- **Verify provenance before replying.** A reply quoting someone else's
  comment or review belongs to THAT thread — engage only when the comment
  addresses the user's own comments or asks the user directly.
  `scan-pr-activity.mts` labels every surfaced reply with the author's role
  (PR author / team / other) and attributes leading quoted text to its
  original author, flagging anything that isn't a reply to the user.
- **No naming bikesheds.** Never weigh in on naming/label/copy debates unless
  the user explicitly asks for a naming opinion.
- **Run every reply through the `prose` skill (conversational mode) so it does
  not read as AI.** The skill strips the tells that make text sound
  machine-written — throat-clearers, emphasis crutches, adverb/hedge stacking,
  business jargon, meta-commentary, em-dash chains, and false-contrast
  reversals (`references/phrases.md`, `structures.md`); `anti-prose-guard` and
  `convo-prose-nudge` enforce them. Junior-dev level and complete sentences are
  part of that same pass, not a separate voice.
- **Comment only — never approve, never request-changes/reject.** Post with
  `gh pr comment` or `gh pr review --comment`; never `gh pr review --approve` or
  `gh pr review --request-changes`. A verdict (approve or request changes) is a
  human's to give — the agent leaves findings and flags the PR for the user.
  Enforced by `no-pr-review-verdict-guard`.

## Skeleton

```markdown
One-line intro: what was traced and the shape of the result.

<details>
<summary><abbr title="Critical: fix before merge/run">🔴</abbr> <b>1. Title a junior dev understands</b></summary>
<blockquote>

Mechanism first, then the step-by-step failure scenario, then
Fix idea 💡: the concrete remediation.

</blockquote>
</details>

<details>
<summary><abbr title="Moderate/minor: worth addressing">🟡</abbr> <b>Smaller items</b></summary>
<blockquote>

- Bullet per nit, complete sentences.

</blockquote>
</details>

Closing verdict referencing item 1 _(short title)_.
```

## Why

These rules were extracted one correction at a time during live review sessions
(fold-outs and junior-level prose, then severity circles, hover text,
severity ordering, item-title references, anchor links, and the 💡 label).
Codifying them as a validator plus this doc makes the format the default
instead of a per-session re-correction. See also
[`prose-style-and-doctrine`](prose-style-and-doctrine.md) for the voice rules
that apply to all conversational surfaces.
