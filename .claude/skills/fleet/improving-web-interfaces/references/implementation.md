# Implementation Guidance

## Use

Read this before changing component composition, UI motion, or accessibility details.
It distills the external sources into fleet routing rather than copying their guidance.

| Source | Apply it for | Fleet boundary |
| --- | --- | --- |
| [emil-design-eng](https://ui-skills.com/skills/emilkowalski/emil-design-eng) | implementation precision and visual hierarchy | Refero owns the reference lock |
| [make-interfaces-feel-better](https://ui-skills.com/skills/jakubkrehel/make-interfaces-feel-better) | interaction feedback and finishing passes | validate a real task path, not isolated chrome |
| [12-principles-of-animation](https://ui-skills.com/skills/raphaelsalaja/12-principles-of-animation) | purposeful motion | support `prefers-reduced-motion`; no decorative motion by default |
| [fixing-accessibility](https://ui-skills.com/skills/ibelick/fixing-accessibility) | semantic, keyboard, focus, and contrast issues | fix the cause in markup/component API, not an ARIA patch over a broken control |
| [shadcn](https://ui-skills.com/skills/shadcn-ui/shadcn) | composable primitives | use only where it fits the existing system; do not import a visual language wholesale |

## Implementation Checks

- A control has a native semantic element unless a native control cannot express it.
- Focus is visible and keyboard operation reaches every interactive action.
- Motion communicates a change and can be reduced or removed without losing meaning.
- Components use the existing token roles; new tokens need a documented role.
- The rendered result has been inspected at the relevant viewport(s).
