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
4. For a locally served page, start the repository's existing development command through the
   package.json script that launches it through `portless`. Test the generated HTTPS `.localhost`
   URL; do not hard-code a port or create another server path.
5. Capture rendered output through
   [rendering-chromium-to-png](../rendering-chromium-to-png/SKILL.md) when visual
   correctness is material.
6. Run the canonical repository test and coverage commands before handoff.

## Boundaries

- Test user-observable outcomes rather than implementation details.
- Keep browser tests independent and avoid fixed sleeps; wait for meaningful UI state.
- Route design review findings to
  [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md).

## Design Cluster

Use [designing-interfaces](../designing-interfaces/SKILL.md) for the intended visual
direction, [improving-web-interfaces](../improving-web-interfaces/SKILL.md) for component
changes, [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md) for rendered
evidence, [extracting-design-systems](../extracting-design-systems/SKILL.md) for shared
patterns, and [optimizing-react-interfaces](../optimizing-react-interfaces/SKILL.md) when the
regression is performance-sensitive.

## References

- [Test-layer selection and source map](references/test-layering.md)
