# Delivery and Craft

## Contents

- [Present findings](#present-findings)
- [Design craft](#design-craft)
- [Quality gate](#quality-gate)
- [Example](#example)

## Present Findings

Do not dump every result. Give the user a short research summary before designing when
the task is non-trivial.

Suggested format:

```text
Research summary:
- Styles reviewed: [count] across [directions]
- Screens reviewed: [count], if used
- Flows reviewed: [count], if used

Visual direction:
- [primary style foundation]
- [reference lock / signature traits to preserve]
- [borrowed detail 1]
- [borrowed detail 2]

Product patterns:
- [concrete UI decisions from screens]

Journey logic:
- [flow decisions, if applicable]

Recommendation:
- [what to design and why]
```

Before implementation, convert research into a short decision ledger:

| Decision                                   | Source                                         | Source rule / role                       | Why                  |
| ------------------------------------------ | ---------------------------------------------- | ---------------------------------------- | -------------------- |
| [palette/type/layout/media/content choice] | [style/screen/flow/user constraint/craft rule] | [token/component/media role to preserve] | [specific rationale] |

If a major choice has no source, do not ship it as a design decision. Either research
more, tie it to the user's constraints, or remove it.

## Design Craft

After research, execute like a senior product designer. Use the bundled references only
when relevant; do not load every file by default.

- Typography: [references/typography.md](references/typography.md)
- Color: [references/color.md](references/color.md)
- Motion: [references/motion.md](references/motion.md)
- Icons: [references/icons.md](references/icons.md)
- Forms, focus, images, touch, performance, accessibility: [references/craft-details.md](references/craft-details.md)
- Copywriting and persuasion: [references/copywriting.md](references/copywriting.md)
- Anti-AI-slop checks: [references/anti-ai-slop.md](references/anti-ai-slop.md)

Core craft rules:

- Define tokens before implementation: type scale, colors, spacing, radius, shadows.
- Preserve the primary reference's strongest traits instead of normalizing them.
- Preserve token roles from references. Do not turn a CTA accent into a background, a
  code-only color into UI chrome, or a decorative gradient into an interface surface.
- Preserve imagery roles from references. Use capable assets when available; otherwise
  prefer an honest, well-sized placeholder over a poor fake illustration or photo.
- Use brand-appropriate colors from research. Do not default to indigo/violet unless the
  user explicitly asks for it.
- Treat "calm editorial" as a current AI-slop risk. Do not default to decorative headline
  word swaps: one word or short phrase set in a different display/serif/script/italic
  style or accent color, warm ivory/cream canvases, or olive/clay/terracotta palettes unless
  research and product context justify them.
- Avoid generic hero -> features grid -> pricing -> FAQ -> CTA unless research supports it.
- Use real product evidence for copy, trust signals, objection handling, and section order.
- Create at least one memorable detail: a visual move, interaction, layout choice, or copy
  detail users would remember.
- Balance headings and short display text with `text-wrap: balance`; use `text-wrap: pretty`
  selectively for prose. Check key breakpoints for orphan words and awkward final lines.
- Keep accessibility and responsive behavior in the design, not as a late pass.

## Quality Gate

Before final delivery, confirm:

- Did I use styles for visual taste?
- Did I avoid copying one style directly?
- Did I synthesize multiple references into a unique direction?
- Did I avoid averaging references into a safe centroid?
- Did I preserve the primary reference's signature traits?
- Did I preserve source token/component roles instead of repurposing them?
- Did I preserve required imagery/media roles with real assets, appropriate primitives, or intentional placeholders?
- Did I use screens when concrete UI patterns were needed?
- Did I use flows when the task had multiple steps?
- Can I name which references influenced the design and why?
- Can every major design choice be traced to a reference, user constraint, or craft rule?
- Did I produce a concept and decision ledger before implementation?
- Does the implementation avoid generic AI design defaults?
- Did I avoid decorative serif/italic/color word swaps unless reference and content role justify them?
- Does the result fit the user's product, audience, and constraints?

If the answer is no, research or refine more before delivering.

For substantial visual work, run the visual QA pass in
[references/visual-workflow.md](references/visual-workflow.md) before handoff.

## Example

For a complete walkthrough, see [references/example-workflow.md](references/example-workflow.md).
