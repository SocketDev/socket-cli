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
- **Finding references hyperlink to their fold-outs.** Put
  `<a name="finding-N"></a>` inside each `<summary>` (anchors in the summary
  stay reachable while the block is collapsed) and link with
  `#user-content-finding-N`.
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
- **Never repeat a bot's feedback.** Before posting, fetch the PR's existing
  reviews and inline comments (Cursor Bugbot, Copilot, github-actions) and drop
  any finding they already made; say so when skipping one.
- **Detect duplicate PRs first.** Search open PRs (title/body keywords + the
  Linear ref) for an already-open PR doing the same thing; report duplicates to
  the requester rather than reviewing both blind.
- **Comment, never approve.** Reviews are flagged for a human to approve.

## Skeleton

```markdown
One-line intro: what was traced and the shape of the result.

<details>
<summary><a name="finding-1"></a><abbr title="Critical: fix before merge/run">🔴</abbr> <b>1. Title a junior dev understands</b></summary>

Mechanism first, then the step-by-step failure scenario, then
Fix idea 💡: the concrete remediation.
</details>

<details>
<summary><abbr title="Moderate/minor: worth addressing">🟡</abbr> <b>Smaller items</b></summary>

- Bullet per nit, complete sentences.
</details>

Closing verdict referencing [item 1](#user-content-finding-1) _(short title)_.
```

## Why

These rules were extracted one correction at a time during live review sessions
(fold-outs and junior-level prose, then severity circles, hover text,
severity ordering, item-title references, anchor links, and the 💡 label).
Codifying them as a validator plus this doc makes the format the default
instead of a per-session re-correction. See also
[`prose-style-and-doctrine`](prose-style-and-doctrine.md) for the voice rules
that apply to all conversational surfaces.
