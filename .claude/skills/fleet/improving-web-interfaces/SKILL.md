---
name: improving-web-interfaces
description: Improves web interfaces after design direction is locked.
---

# Improving Web Interfaces

Use this for implementation craft after [Designing Interfaces](../designing-interfaces/SKILL.md)
has locked the visual direction. It is not a second design authority.

## Workflow

1. Read the applicable sections of [implementation.md](references/implementation.md).
2. Preserve the locked tokens, hierarchy, and component roles; improve one user-facing
   path at a time. Make a design more decisive through hierarchy, proportion, density, and
   copy before adding colors, effects, or new components.
   For copy, density, onboarding, or tone tuning, read
   [interface-copy.md](../designing-interfaces/references/interface-copy.md) and
   [refinement-modes.md](../designing-interfaces/references/refinement-modes.md).
3. When the existing system cannot express the intended direction, name the precise token
   or component addition and get approval before expanding the system.
4. Use motion only to explain state, spatial change, or feedback. Respect reduced motion.
5. Check keyboard use, focus visibility, semantics, and contrast before visual polish.
6. Build loading, error, empty, permission, and read-only states alongside the primary path;
   preserve user input on recoverable failure and leave room for localized text.
7. Give every action and recovery state specific, user-facing copy. Name destructive outcomes,
   explain errors in plain language, and make the next action clear.
8. Render the result and compare it to the reference lock using
   [rendering-chromium-to-png](../rendering-chromium-to-png/SKILL.md).

## Boundaries

- Prefer existing primitives and tokens over introducing a parallel component system.
- Do not add animation, cards, gradients, or decorative effects without a user/task role.
- Route React runtime performance work to
  [optimizing-react-interfaces](../optimizing-react-interfaces/SKILL.md).
- Route an evidence-backed review to
  [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md).
- Route repeated, mature patterns to
  [extracting-design-systems](../extracting-design-systems/SKILL.md).
- Route browser and component regression coverage to
  [testing-web-interfaces](../testing-web-interfaces/SKILL.md).

## Design Cluster

This is the build companion, not an isolated workflow. Keep the work connected to
[designing-interfaces](../designing-interfaces/SKILL.md) for direction,
[reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md) for evidence,
[extracting-design-systems](../extracting-design-systems/SKILL.md) for proven reuse,
[optimizing-react-interfaces](../optimizing-react-interfaces/SKILL.md) for measured
React performance, and [testing-web-interfaces](../testing-web-interfaces/SKILL.md)
for regression proof.

## References

- [Implementation guidance and source map](references/implementation.md)
