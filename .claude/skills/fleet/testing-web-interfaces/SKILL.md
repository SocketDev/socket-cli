---
name: testing-web-interfaces
description: Tests web interfaces across component and browser layers.
---

# Testing Web Interfaces

Choose the lowest layer that proves the user-visible behavior, then add a browser test
when interaction, layout, navigation, or rendering integration is the risk.

## Workflow

1. Read [test-layering.md](references/test-layering.md) and state the behavior and
   failure mode before choosing a tool.
2. Write focused Vitest coverage for deterministic component/state behavior.
3. Use the repository’s browser-test setup for real navigation, keyboard behavior,
   responsive state, and browser APIs. Do not create a competing runner.
4. Capture rendered output through
   [rendering-chromium-to-png](../rendering-chromium-to-png/SKILL.md) when visual
   correctness is material.
5. Run the canonical repository test and coverage commands before handoff.

## Boundaries

- Test user-observable outcomes rather than implementation details.
- Keep browser tests independent and avoid fixed sleeps; wait for meaningful UI state.
- Route design review findings to
  [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md).

## References

- [Test-layer selection and source map](references/test-layering.md)
