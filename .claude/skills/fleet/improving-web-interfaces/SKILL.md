---
name: improving-web-interfaces
description: Improves web interfaces after design direction is locked.
---

# Improving Web Interfaces

Use this for implementation craft after [Refero Design](../refero-design/SKILL.md)
has locked the visual direction. It is not a second design authority.

## Workflow

1. Read the applicable sections of [implementation.md](references/implementation.md).
2. Preserve the locked tokens, hierarchy, and component roles; improve one user-facing
   path at a time.
3. Use motion only to explain state, spatial change, or feedback. Respect reduced motion.
4. Check keyboard use, focus visibility, semantics, and contrast before visual polish.
5. Render the result and compare it to the reference lock using
   [rendering-chromium-to-png](../rendering-chromium-to-png/SKILL.md).

## Boundaries

- Prefer existing primitives and tokens over introducing a parallel component system.
- Do not add animation, cards, gradients, or decorative effects without a user/task role.
- Route React runtime performance work to
  [optimizing-react-interfaces](../optimizing-react-interfaces/SKILL.md).
- Route an evidence-backed review to
  [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md).

## References

- [Implementation guidance and source map](references/implementation.md)
