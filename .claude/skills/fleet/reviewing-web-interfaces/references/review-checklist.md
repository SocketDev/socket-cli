# Review Checklist

Use the narrowest relevant checks; do not turn a small UI repair into an unsolicited redesign.

## Interaction and Accessibility

- Native semantics, label relationships, keyboard operation, and visible focus are correct.
- Content does not rely on color, hover, or animation alone to convey meaning.
- Error, loading, empty, and disabled states remain understandable.

## Layout and Responsiveness

- The primary task remains obvious at narrow and wide viewports.
- Text wraps without clipping; controls retain usable targets and spacing.
- Repeated surfaces communicate grouping rather than adding card-on-card noise.

## Production States

- Long, empty, localized, and bidirectional text preserve hierarchy without clipping or
  fixed-width controls; format dates, numbers, and currency for the active locale.
- Loading, error, empty, offline, permission, and read-only states explain what happened
  and give the user a specific next action where recovery is possible.
- Submissions prevent accidental duplicates, preserve input after a recoverable failure,
  and surface conflicts or stale data without hiding user work.
- Large result sets remain usable through pagination, virtualization, filtering, or another
  task-appropriate boundary.

## Copy and Recovery

- Labels and actions name the user's outcome. Avoid generic confirmations such as `OK`,
  `Submit`, or `Yes`; destructive actions name what they will delete.
- Errors state what happened, identify the affected task or field, and give a concrete repair
  path without blaming the user. Empty, loading, and success states explain the next step when
  one exists.
- Help text adds missing context, format examples, or consequences. It does not repeat the
  label or rely on a placeholder that disappears while the user is typing.

## Visual and Motion Quality

- Typography and color roles match the Refero lock or existing system.
- Animation has a state-transition purpose and honors reduced motion.
- Decorations do not compete with task-critical content.

## Source Map

- [fixing-accessibility](https://ui-skills.com/skills/ibelick/fixing-accessibility)
- [make-interfaces-feel-better](https://ui-skills.com/skills/jakubkrehel/make-interfaces-feel-better)
- [12-principles-of-animation](https://ui-skills.com/skills/raphaelsalaja/12-principles-of-animation)
