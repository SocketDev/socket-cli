---
name: extracting-design-systems
description: Consolidates repeated UI patterns. Use after a pattern proves stable.
---

# Extracting Design Systems

Extract only patterns with demonstrated repetition and a shared user-facing role. Preserve
the design direction locked by [designing-interfaces](../designing-interfaces/SKILL.md).

## Workflow

1. Inventory the candidate instances and confirm their shared role, states, and variation.
   Two instances can be coincidental; three or more similar instances may justify extraction.
2. Identify the smallest reusable unit: token, primitive, component, or documented usage
   rule. Keep distinct intents separate even when they look similar.
3. Define a focused API from current uses. Do not add speculative variants or configuration.
4. Migrate every matching call site in the same change. Remove replaced local styles and
   duplicate implementations.
5. Render representative states and run the repository's checks. Verify that extraction
   preserves semantics, keyboard behavior, responsive layout, and the locked visual roles.

## Boundaries

- Prefer existing tokens and primitives over a parallel component system.
- Add a token or component only when the current system cannot express a proven need.
- Keep design-system changes reviewable: name the instances, the shared rule, and each
  migrated call site.
- Route broad design direction to
  [designing-interfaces](../designing-interfaces/SKILL.md), implementation details to
  [improving-web-interfaces](../improving-web-interfaces/SKILL.md), and rendered review to
  [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md). Route performance-sensitive
  reuse to [optimizing-react-interfaces](../optimizing-react-interfaces/SKILL.md) and behavior
  coverage to [testing-web-interfaces](../testing-web-interfaces/SKILL.md).
