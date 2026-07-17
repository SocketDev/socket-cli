---
name: optimizing-react-interfaces
description: Optimizes measured React interface performance.
---

# Optimizing React Interfaces

Measure first. A memo, callback, lazy boundary, or rewrite is not an optimization unless
it addresses a measured rendering, interaction, or bundle cost.

## Workflow

1. Define the slow user interaction and capture a baseline: route, device class, and
   observable metric.
2. Read [react-performance.md](references/react-performance.md) and select the smallest
   relevant diagnostic: render profiling, bundle inspection, network waterfall, or
   component boundary review.
3. Change one causal bottleneck at a time. Preserve accessibility and the locked visual
   behavior.
4. Re-measure the same interaction; keep the change only when it improves the target
   without a meaningful regression.
5. Add or update a regression test where the behavior is testable. Use
   [testing-web-interfaces](../testing-web-interfaces/SKILL.md) for that work.

## Boundaries

- Do not apply blanket `memo`, `useCallback`, or code splitting.
- Prefer local state and stable component boundaries before adding caching machinery.
- Route visual quality questions to
  [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md).

## References

- [React performance routing and sources](references/react-performance.md)
